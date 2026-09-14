import { Store, investedTotal, proceedsTotal } from "./storage.js";
import {
  formatCurrency, formatPercent, monthKey, todayMonthKey, addMonths, monthLabel,
  lastNMonths, CLASS_LABELS, RISK_PROFILES, uniqueSorted, xirr, formatDateBR, clamp,
  categoryBreakdown, isDuplicateTransaction, sha256Hex, isImportedPlaceholderAccount,
} from "./utils.js";
import { parseCSV, guessMapping, rowsToTransactions } from "./csv-import.js";
import { parseOFX } from "./ofx-import.js";
import { computeOpportunities, computeFireProjection } from "./advisor.js";
import { applyCategoryRules } from "./categorize.js";
import * as AutoImport from "./auto-import.js";
import {
  cashflowChart, allocationChart, categoriesChart, targetVsActualChart, netWorthChart,
  budgetHistoryChart, accountsBalanceChart,
} from "./charts.js";
import { accountBalance, allAccountBalances, creditCardInvoices, netWorthTotal } from "./accounts.js";
import { loanMonthlyPayment, remainingBalance, totalLoansRemaining } from "./loans.js";
import { computeDueTransactions } from "./recurring.js";
import { fetchStockQuote, fetchCryptoQuote } from "./quotes.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const ACCOUNT_TYPE_LABELS = {
  corrente: "Conta corrente", poupanca: "Poupança", carteira: "Carteira", cartao_credito: "Cartão de crédito",
};

let dashMonth = todayMonthKey();
let csvStaging = null; // { headers, rows, mapping }
let txPage = 1;
const TX_PAGE_SIZE = 25;
let txSelected = new Set();
let editingRuleId = null;
let splitRowCount = 0;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ---------- navigation ----------
function switchView(view) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
}

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (btn) switchView(btn.dataset.view);
});

function toast(msg) {
  const el = $("#toast");
  $("#toast-msg").textContent = msg;
  $("#toast-undo").hidden = true;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2800);
}

function toastWithUndo(msg, onUndo, delay = 5000) {
  const el = $("#toast");
  const undoBtn = $("#toast-undo");
  $("#toast-msg").textContent = msg;
  undoBtn.hidden = false;
  el.hidden = false;
  clearTimeout(toast._t);
  let undone = false;
  const handler = () => {
    undone = true;
    onUndo();
    el.hidden = true;
    undoBtn.removeEventListener("click", handler);
  };
  undoBtn.addEventListener("click", handler);
  toast._t = setTimeout(() => {
    undoBtn.removeEventListener("click", handler);
    if (!undone) el.hidden = true;
  }, delay);
}

function deleteWithUndo(item, removeFn, addFn, label, rerender) {
  removeFn(item.id);
  rerender();
  toastWithUndo(`${label} excluído(a).`, () => { addFn(item); rerender(); });
}

// ---------- theme ----------
function applyTheme() {
  const { settings } = Store.get();
  const root = document.documentElement;
  if (settings.theme === "light") root.setAttribute("data-theme", "light");
  else if (settings.theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

$("#btn-theme-toggle").addEventListener("click", () => {
  const { settings } = Store.get();
  const order = ["system", "light", "dark"];
  const next = order[(order.indexOf(settings.theme) + 1) % order.length];
  Store.updateSettings({ theme: next });
  applyTheme();
  renderSettings();
  toast(`Tema: ${next === "system" ? "automático" : next === "light" ? "claro" : "escuro"}`);
});

// ---------- category & account selects ----------
function populateCategorySelects() {
  const { settings } = Store.get();
  const txType = $("#tx-type").value;
  const cats = txType === "income" ? settings.incomeCategories : settings.expenseCategories;
  $("#tx-category").innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join("");

  const filterCat = $("#tx-filter-category");
  const allCats = uniqueSorted([...settings.expenseCategories, ...settings.incomeCategories]);
  const current = filterCat.value;
  filterCat.innerHTML = `<option value="">Todas categorias</option>` + allCats.map((c) => `<option value="${c}">${c}</option>`).join("");
  filterCat.value = current;

  $("#bill-category").innerHTML = settings.expenseCategories.map((c) => `<option value="${c}">${c}</option>`).join("");

  const ruleType = $("#rule-type").value;
  const ruleCats = ruleType === "income" ? settings.incomeCategories : settings.expenseCategories;
  $("#rule-category").innerHTML = ruleCats.map((c) => `<option value="${c}">${c}</option>`).join("");

  $$(".split-category-select").forEach((sel) => {
    const cur = sel.value;
    sel.innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join("");
    if (cats.includes(cur)) sel.value = cur;
  });
}

function populateAccountSelects() {
  const { accounts } = Store.get();
  const options = accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");

  ["#tx-account", "#bill-account", "#csv-account"].forEach((sel) => {
    const el = $(sel);
    const current = el.value;
    el.innerHTML = `<option value="">(não informar)</option>` + options;
    el.value = current;
  });

  const filterEl = $("#tx-filter-account");
  const curFilter = filterEl.value;
  filterEl.innerHTML = `<option value="">Todas contas</option>` + options;
  filterEl.value = curFilter;

  ["#transfer-from", "#transfer-to"].forEach((sel) => { $(sel).innerHTML = options; });
}

function accountLabel(t) {
  if (t.accountId) {
    const acc = Store.get().accounts.find((a) => a.id === t.accountId);
    if (acc) return acc.name;
  }
  return t.account || "—";
}

$("#tx-type").addEventListener("change", () => { populateCategorySelects(); updateInstallmentVisibility(); });
$("#rule-type").addEventListener("change", populateCategorySelects);

$("#tx-description").addEventListener("blur", () => {
  const { categoryRules } = Store.get();
  const suggested = applyCategoryRules($("#tx-description").value, $("#tx-type").value, categoryRules);
  if (suggested) $("#tx-category").value = suggested;
});

// ============================================================
// DASHBOARD
// ============================================================
function monthRangeList() {
  let from = $("#dash-range-from").value;
  let to = $("#dash-range-to").value;
  if (!from || !to) {
    const months = lastNMonths(6, dashMonth);
    from = months[0];
    to = months[months.length - 1];
    $("#dash-range-from").value = from;
    $("#dash-range-to").value = to;
  }
  if (from > to) { const tmp = from; from = to; to = tmp; }
  const months = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 240) {
    months.push(cursor);
    if (cursor === to) break;
    cursor = addMonths(cursor, 1);
    guard++;
  }
  return months;
}

function renderDashboard() {
  const state = Store.get();
  const { transactions, investments } = state;
  $("#dash-month-label").textContent = monthLabel(dashMonth);

  const monthTx = transactions.filter((t) => monthKey(t.date) === dashMonth);
  const income = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

  $("#stat-income").textContent = formatCurrency(income);
  $("#stat-expense").textContent = formatCurrency(expense);
  const balanceEl = $("#stat-balance");
  balanceEl.textContent = formatCurrency(income - expense);
  balanceEl.className = "stat-value " + (income - expense >= 0 ? "positive" : "negative");
  $("#stat-networth").textContent = formatCurrency(netWorthTotal(state));

  const months = monthRangeList();
  const labels = months.map((m) => monthLabel(m).split(" de")[0]);
  const incomeSeries = months.map((m) => transactions.filter((t) => t.type === "income" && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0));
  const expenseSeries = months.map((m) => transactions.filter((t) => t.type === "expense" && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0));
  cashflowChart("chart-cashflow", months, labels, incomeSeries, expenseSeries);

  const byClass = {};
  investments.forEach((i) => { byClass[i.class] = (byClass[i.class] || 0) + i.currentValue; });
  const allocLabels = Object.keys(byClass).map((k) => CLASS_LABELS[k] || k);
  allocationChart("chart-allocation", allocLabels, Object.values(byClass));

  const byCat = {};
  monthTx.filter((t) => t.type === "expense").flatMap(categoryBreakdown).forEach((s) => { byCat[s.category] = (byCat[s.category] || 0) + s.amount; });
  const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  categoriesChart("chart-categories", sortedCats.map((c) => c[0]), sortedCats.map((c) => c[1]));

  const opps = computeOpportunities(state);
  $("#dash-opportunities-list").innerHTML = renderOpportunityCards(opps.slice(0, 3));

  const historySorted = state.netWorthHistory.slice().sort((a, b) => a.month.localeCompare(b.month));
  netWorthChart("chart-networth", historySorted.map((h) => monthLabel(h.month).split(" de")[0]), historySorted.map((h) => h.netWorth));

  const accBalances = allAccountBalances(state);
  accountsBalanceChart("chart-accounts", accBalances.map((x) => x.account.name), accBalances.map((x) => x.balance));
}

$("#dash-prev-month").addEventListener("click", () => { dashMonth = addMonths(dashMonth, -1); renderDashboard(); });
$("#dash-next-month").addEventListener("click", () => { dashMonth = addMonths(dashMonth, 1); renderDashboard(); });
$("#dash-range-from").addEventListener("change", renderDashboard);
$("#dash-range-to").addEventListener("change", renderDashboard);

// ============================================================
// TRANSAÇÕES
// ============================================================
function getFilteredSortedTransactions() {
  const { transactions } = Store.get();
  const filterMonth = $("#tx-filter-month").value;
  const filterCat = $("#tx-filter-category").value;
  const filterAccount = $("#tx-filter-account").value;
  const search = $("#tx-search").value.trim().toLowerCase();
  const min = parseFloat($("#tx-filter-min").value);
  const max = parseFloat($("#tx-filter-max").value);
  const sort = $("#tx-sort").value;

  let list = transactions.slice();
  if (filterMonth) list = list.filter((t) => monthKey(t.date) === filterMonth);
  if (filterCat) list = list.filter((t) => t.category === filterCat || (t.splits || []).some((s) => s.category === filterCat));
  if (filterAccount) list = list.filter((t) => t.accountId === filterAccount || t.toAccountId === filterAccount);
  if (search) list = list.filter((t) => (t.description || "").toLowerCase().includes(search));
  if (!Number.isNaN(min)) list = list.filter((t) => t.amount >= min);
  if (!Number.isNaN(max)) list = list.filter((t) => t.amount <= max);

  const [sortField, sortDir] = sort.split("-");
  list.sort((a, b) => {
    const cmp = sortField === "amount" ? a.amount - b.amount : a.date.localeCompare(b.date);
    return sortDir === "desc" ? -cmp : cmp;
  });
  return list;
}

function renderTransactions() {
  const state = Store.get();
  const list = getFilteredSortedTransactions();
  const totalPages = Math.max(1, Math.ceil(list.length / TX_PAGE_SIZE));
  txPage = clamp(txPage, 1, totalPages);
  const pageItems = list.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE);

  const tbody = $("#tx-table-body");
  tbody.innerHTML = pageItems.map((t) => {
    const checked = txSelected.has(t.id) ? "checked" : "";
    let categoryCell;
    let amountCell;
    if (t.type === "transfer") {
      const toAcc = state.accounts.find((a) => a.id === t.toAccountId);
      categoryCell = `Transferência → ${escapeHtml(toAcc ? toAcc.name : "—")}`;
      amountCell = `<span class="amount-transfer">⇄ ${formatCurrency(t.amount)}</span>`;
    } else {
      categoryCell = Array.isArray(t.splits) && t.splits.length > 0
        ? `Múltiplas (${t.splits.length}) <span class="muted">· ${t.splits.map((s) => escapeHtml(s.category)).join(", ")}</span>`
        : escapeHtml(t.category);
      amountCell = `<span class="amount-${t.type}">${t.type === "expense" ? "-" : "+"} ${formatCurrency(t.amount)}</span>`;
    }
    const installmentBadge = t.installmentTotal
      ? ` <span class="installment-badge">(${t.installmentIndex}/${t.installmentTotal})</span>` : "";
    return `
      <tr data-id="${t.id}">
        <td><input type="checkbox" class="tx-select" data-id="${t.id}" ${checked}></td>
        <td>${formatDateBR(t.date)}</td>
        <td>${escapeHtml(t.description)}${installmentBadge}</td>
        <td>${categoryCell}</td>
        <td>${escapeHtml(accountLabel(t))}</td>
        <td class="right">${amountCell}</td>
        <td class="row-actions">
          <button class="btn secondary small" data-action="edit-tx">Editar</button>
          <button class="btn danger small" data-action="del-tx">Excluir</button>
        </td>
      </tr>
    `;
  }).join("");

  $("#tx-empty").hidden = list.length > 0;
  renderTxPagination(totalPages);
  updateBulkBar();

  const allChecked = pageItems.length > 0 && pageItems.every((t) => txSelected.has(t.id));
  $("#tx-select-all").checked = allChecked;
}

function renderTxPagination(totalPages) {
  $("#tx-pagination").innerHTML = `
    <button id="tx-page-prev" ${txPage <= 1 ? "disabled" : ""} type="button">‹ Anterior</button>
    <span>Página ${txPage} de ${totalPages}</span>
    <button id="tx-page-next" ${txPage >= totalPages ? "disabled" : ""} type="button">Próxima ›</button>
  `;
  const prev = $("#tx-page-prev"); const next = $("#tx-page-next");
  if (prev) prev.addEventListener("click", () => { txPage--; renderTransactions(); });
  if (next) next.addEventListener("click", () => { txPage++; renderTransactions(); });
}

function updateBulkBar() {
  const count = txSelected.size;
  $("#tx-bulk-actions").hidden = count === 0;
  $("#tx-bulk-count").textContent = `${count} selecionada(s)`;
}

["#tx-filter-month", "#tx-filter-category", "#tx-filter-account", "#tx-filter-min", "#tx-filter-max", "#tx-sort"]
  .forEach((sel) => $(sel).addEventListener("change", () => { txPage = 1; renderTransactions(); }));
$("#tx-search").addEventListener("input", () => { txPage = 1; renderTransactions(); });

$("#tx-select-all").addEventListener("change", (e) => {
  const pageItems = getFilteredSortedTransactions().slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE);
  if (e.target.checked) pageItems.forEach((t) => txSelected.add(t.id));
  else pageItems.forEach((t) => txSelected.delete(t.id));
  renderTransactions();
});

$("#tx-table-body").addEventListener("click", (e) => {
  const row = e.target.closest("tr");
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.classList.contains("tx-select")) {
    if (e.target.checked) txSelected.add(id); else txSelected.delete(id);
    updateBulkBar();
    $("#tx-select-all").checked = getFilteredSortedTransactions()
      .slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE).every((t) => txSelected.has(t.id));
    return;
  }
  if (e.target.dataset.action === "edit-tx") openTxModal(id);
  if (e.target.dataset.action === "del-tx") {
    const tx = Store.get().transactions.find((t) => t.id === id);
    deleteWithUndo(tx, Store.removeTransaction, Store.addTransaction, "Transação", () => { renderTransactions(); renderDashboard(); });
  }
});

$("#btn-bulk-delete-tx").addEventListener("click", () => {
  const ids = Array.from(txSelected);
  const items = Store.get().transactions.filter((t) => ids.includes(t.id));
  Store.removeTransactions(ids);
  txSelected.clear();
  renderTransactions();
  renderDashboard();
  toastWithUndo(`${items.length} transação(ões) excluída(s).`, () => {
    items.forEach((t) => Store.addTransaction(t));
    renderTransactions();
    renderDashboard();
  });
});

function updateInstallmentVisibility() {
  const isExpense = $("#tx-type").value === "expense";
  const isEdit = Boolean($("#tx-id").value);
  $("#tx-installments-label").hidden = !isExpense || isEdit;
  if (!isExpense || isEdit) $("#tx-installments").value = 1;
}

function resetSplits() {
  $("#tx-splits-rows").innerHTML = "";
  splitRowCount = 0;
  $("#tx-split-toggle").checked = false;
  $("#tx-splits").hidden = true;
  $("#tx-category-label").hidden = false;
}

function addSplitRow(category = "", amount = "") {
  const { settings } = Store.get();
  const txType = $("#tx-type").value;
  const cats = txType === "income" ? settings.incomeCategories : settings.expenseCategories;
  const rowId = `split-${splitRowCount++}`;
  const row = document.createElement("div");
  row.className = "csv-mapping";
  row.dataset.rowId = rowId;
  row.innerHTML = `
    <label>Categoria <select class="split-category-select">${cats.map((c) => `<option value="${c}" ${c === category ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    <label>Valor (R$) <input type="number" step="0.01" min="0" class="split-amount-input" value="${amount}"></label>
    <label>&nbsp;<button type="button" class="btn danger small" data-remove-split>Remover</button></label>
  `;
  $("#tx-splits-rows").appendChild(row);
  row.querySelector("[data-remove-split]").addEventListener("click", () => { row.remove(); updateSplitRemainder(); });
  row.querySelector(".split-amount-input").addEventListener("input", updateSplitRemainder);
}

function updateSplitRemainder() {
  const total = parseFloat($("#tx-amount").value) || 0;
  const splitTotal = $$(".split-amount-input").reduce((s, el) => s + (parseFloat(el.value) || 0), 0);
  const remainder = Math.round((total - splitTotal) * 100) / 100;
  const el = $("#tx-splits-remainder");
  if (Math.abs(remainder) < 0.005) { el.textContent = "Divisões batem com o valor total."; el.style.color = "var(--positive)"; }
  else { el.textContent = remainder > 0 ? `Restam ${formatCurrency(remainder)} para dividir.` : `Excedeu em ${formatCurrency(-remainder)}.`; el.style.color = "var(--negative)"; }
}

$("#tx-split-toggle").addEventListener("change", (e) => {
  $("#tx-splits").hidden = !e.target.checked;
  $("#tx-category-label").hidden = e.target.checked;
  if (e.target.checked && $("#tx-splits-rows").children.length === 0) { addSplitRow(); addSplitRow(); }
  updateSplitRemainder();
});
$("#btn-add-split").addEventListener("click", () => { addSplitRow(); updateSplitRemainder(); });
$("#tx-amount").addEventListener("input", updateSplitRemainder);

function openTxModal(id) {
  populateCategorySelects();
  populateAccountSelects();
  resetSplits();
  const modal = $("#modal-tx");
  if (id) {
    const tx = Store.get().transactions.find((t) => t.id === id);
    $("#modal-tx-title").textContent = "Editar transação";
    $("#tx-id").value = tx.id;
    $("#tx-type").value = tx.type;
    populateCategorySelects();
    $("#tx-date").value = tx.date;
    $("#tx-description").value = tx.description;
    $("#tx-category").value = tx.category;
    $("#tx-account").value = tx.accountId || "";
    $("#tx-amount").value = tx.amount;
    if (Array.isArray(tx.splits) && tx.splits.length > 0) {
      $("#tx-split-toggle").checked = true;
      $("#tx-splits").hidden = false;
      $("#tx-category-label").hidden = true;
      tx.splits.forEach((s) => addSplitRow(s.category, s.amount));
      updateSplitRemainder();
    }
  } else {
    $("#modal-tx-title").textContent = "Nova transação";
    $("#form-tx").reset();
    $("#tx-id").value = "";
    $("#tx-date").value = new Date().toISOString().slice(0, 10);
    populateCategorySelects();
  }
  updateInstallmentVisibility();
  modal.hidden = false;
}

$("#btn-add-tx").addEventListener("click", () => openTxModal(null));
$("#btn-cancel-tx").addEventListener("click", () => { $("#modal-tx").hidden = true; });

$("#form-tx").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#tx-id").value;
  const useSplits = $("#tx-split-toggle").checked;
  const totalAmount = parseFloat($("#tx-amount").value);
  let splits = null;
  if (useSplits) {
    splits = $$(".split-amount-input").map((el, i) => ({
      category: $$(".split-category-select")[i].value,
      amount: parseFloat(el.value) || 0,
    })).filter((s) => s.amount > 0);
    const sum = splits.reduce((s, x) => s + x.amount, 0);
    if (splits.length < 2 || Math.abs(sum - totalAmount) > 0.01) {
      toast("As divisões precisam somar o valor total da transação.");
      return;
    }
  }
  const payload = {
    type: $("#tx-type").value,
    date: $("#tx-date").value,
    description: $("#tx-description").value.trim(),
    category: useSplits ? "Múltiplas categorias" : $("#tx-category").value,
    accountId: $("#tx-account").value,
    amount: totalAmount,
    splits: splits || undefined,
  };
  const installments = parseInt($("#tx-installments").value, 10) || 1;
  if (id) {
    Store.updateTransaction(id, payload);
  } else if (installments > 1 && !useSplits) {
    Store.addInstallmentTransactions(payload, installments);
  } else {
    Store.addTransaction(payload);
  }
  $("#modal-tx").hidden = true;
  renderTransactions();
  renderDashboard();
  renderBudget();
  renderOpportunitiesView();
  toast("Transação salva.");
});

// ---- transferências ----
function openTransferModal() {
  populateAccountSelects();
  $("#transfer-date").value = new Date().toISOString().slice(0, 10);
  $("#transfer-description").value = "";
  $("#transfer-amount").value = "";
  $("#modal-transfer").hidden = false;
}
$("#btn-add-transfer").addEventListener("click", openTransferModal);
$("#btn-add-transfer-2").addEventListener("click", openTransferModal);
$("#btn-cancel-transfer").addEventListener("click", () => { $("#modal-transfer").hidden = true; });

$("#form-transfer").addEventListener("submit", (e) => {
  e.preventDefault();
  const from = $("#transfer-from").value;
  const to = $("#transfer-to").value;
  if (!from || !to || from === to) { toast("Selecione duas contas diferentes."); return; }
  Store.addTransfer({
    date: $("#transfer-date").value,
    description: $("#transfer-description").value.trim(),
    fromAccountId: from,
    toAccountId: to,
    amount: parseFloat($("#transfer-amount").value),
  });
  $("#modal-transfer").hidden = true;
  renderTransactions();
  renderAccounts();
  renderDashboard();
  toast("Transferência registrada.");
});

// ---- CSV import ----
$("#btn-import-csv").addEventListener("click", () => $("#file-csv").click());

$("#file-csv").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const { headers, rows } = parseCSV(text);
  if (headers.length === 0) { toast("Não foi possível ler o CSV."); return; }
  csvStaging = { headers, rows, mapping: guessMapping(headers) };
  openCsvModal();
  e.target.value = "";
});

function openCsvModal() {
  const { headers, rows, mapping } = csvStaging;
  const fieldNames = { date: "Data", description: "Descrição", amount: "Valor", type: "Tipo (opcional)", category: "Categoria (opcional)", account: "Conta (opcional)" };
  const optionalFields = new Set(["type", "category", "account"]);
  const mappingHtml = Object.keys(fieldNames).map((field) => `
    <label>${fieldNames[field]}
      <select data-field="${field}">
        ${optionalFields.has(field) ? `<option value="-1" ${mapping[field] === -1 ? "selected" : ""}>(não usar)</option>` : ""}
        ${headers.map((h, i) => `<option value="${i}" ${mapping[field] === i ? "selected" : ""}>${escapeHtml(h)}</option>`).join("")}
      </select>
    </label>
  `).join("");
  $("#csv-mapping").innerHTML = mappingHtml;
  $$('#csv-mapping select').forEach((sel) => sel.addEventListener("change", () => {
    csvStaging.mapping[sel.dataset.field] = parseInt(sel.value, 10);
  }));
  populateAccountSelects();

  const previewRows = rows.slice(0, 8);
  $("#csv-preview-table").innerHTML =
    `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${previewRows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;

  $("#modal-csv").hidden = false;
}

$("#btn-cancel-csv").addEventListener("click", () => { $("#modal-csv").hidden = true; csvStaging = null; });

function withAutoCategory(txs) {
  const { categoryRules } = Store.get();
  return txs.map((tx) => {
    const suggested = applyCategoryRules(tx.description, tx.type, categoryRules);
    return suggested ? { ...tx, category: suggested } : tx;
  });
}

function dedupeAgainstExisting(candidates) {
  const { transactions: existing } = Store.get();
  const toImport = [];
  let duplicates = 0;
  candidates.forEach((tx) => {
    if (isDuplicateTransaction(tx, existing.concat(toImport))) duplicates++;
    else toImport.push(tx);
  });
  return { toImport, duplicates };
}

$("#btn-confirm-csv").addEventListener("click", () => {
  if (!csvStaging) return;
  const { rows, mapping } = csvStaging;
  if (mapping.date < 0 || mapping.amount < 0) { toast("Selecione ao menos as colunas de data e valor."); return; }
  const selectedAccountId = $("#csv-account").value;
  const parsed = rowsToTransactions(rows, mapping).map((tx) => ({
    ...tx,
    accountId: selectedAccountId || (!isImportedPlaceholderAccount(tx.account) ? Store.findOrCreateAccount(tx.account) : ""),
  }));
  const withCategory = withAutoCategory(parsed);
  const { toImport, duplicates } = dedupeAgainstExisting(withCategory);
  if (toImport.length === 0) {
    toast(duplicates > 0 ? `As ${duplicates} transações já existiam — nada importado.` : "Nenhuma transação válida encontrada no arquivo.");
    return;
  }
  Store.addTransactions(toImport);
  $("#modal-csv").hidden = true;
  csvStaging = null;
  renderTransactions();
  renderDashboard();
  toast(`${toImport.length} transações importadas.${duplicates > 0 ? ` ${duplicates} duplicada(s) ignorada(s).` : ""}`);
});

// ---- OFX import ----
$("#btn-import-ofx").addEventListener("click", () => $("#file-ofx").click());

$("#file-ofx").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parsed = withAutoCategory(parseOFX(text));
  const { toImport, duplicates } = dedupeAgainstExisting(parsed);
  if (toImport.length === 0) {
    toast(duplicates > 0 ? `As ${duplicates} transações já existiam — nada importado.` : "Nenhuma transação encontrada no arquivo OFX.");
  } else {
    Store.addTransactions(toImport);
    renderTransactions();
    renderDashboard();
    toast(`${toImport.length} transações importadas do OFX.${duplicates > 0 ? ` ${duplicates} duplicada(s) ignorada(s).` : ""}`);
  }
  e.target.value = "";
});

// ---- Importação automática de pasta ----
let autoImportDirHandle = null;
let autoImportNeedsReauth = false;

function summaryToast(summary) {
  if (summary.filesImported === 0 && summary.errors.length === 0) return;
  const parts = [];
  if (summary.transactionsImported > 0) parts.push(`${summary.transactionsImported} transação(ões) importada(s)`);
  if (summary.duplicatesSkipped > 0) parts.push(`${summary.duplicatesSkipped} duplicada(s) ignorada(s)`);
  if (summary.errors.length > 0) parts.push(`${summary.errors.length} arquivo(s) com erro`);
  if (parts.length > 0) toast(`Pasta verificada: ${parts.join(", ")}.`);
}

function renderAutoImportStatus() {
  const statusEl = $("#auto-import-status");
  const rescanBtn = $("#btn-rescan-auto-folder");
  const forgetBtn = $("#btn-forget-auto-folder");
  if (!AutoImport.isSupported()) {
    statusEl.textContent = "Seu navegador não suporta escolher uma pasta (funciona em Chrome/Edge/Brave).";
    rescanBtn.hidden = true;
    forgetBtn.hidden = true;
    return;
  }
  if (!autoImportDirHandle) {
    statusEl.textContent = "Nenhuma pasta selecionada.";
    rescanBtn.hidden = true;
    forgetBtn.hidden = true;
    return;
  }
  statusEl.textContent = autoImportNeedsReauth
    ? `Pasta "${autoImportDirHandle.name}" — acesso expirou, clique em "Verificar agora" para autorizar de novo.`
    : `Pasta selecionada: "${autoImportDirHandle.name}".`;
  rescanBtn.hidden = false;
  forgetBtn.hidden = false;
}

async function runAutoImportScan(handle, { requestPermission }) {
  const ok = await AutoImport.verifyPermission(handle, requestPermission);
  autoImportNeedsReauth = !ok;
  if (!ok) { renderAutoImportStatus(); return; }
  const summary = await AutoImport.scanAndImport(handle);
  if (summary.transactionsImported > 0) { renderTransactions(); renderDashboard(); renderAccounts(); }
  summaryToast(summary);
  renderAutoImportStatus();
}

$("#btn-select-auto-folder").addEventListener("click", async () => {
  if (!AutoImport.isSupported()) { toast("Seu navegador não suporta essa função."); return; }
  try {
    const handle = await window.showDirectoryPicker();
    await AutoImport.saveDirectoryHandle(handle);
    autoImportDirHandle = handle;
    await runAutoImportScan(handle, { requestPermission: true });
  } catch (err) {
    if (err.name !== "AbortError") toast("Não foi possível acessar a pasta.");
  }
});

$("#btn-rescan-auto-folder").addEventListener("click", async () => {
  if (!autoImportDirHandle) return;
  await runAutoImportScan(autoImportDirHandle, { requestPermission: true });
});

$("#btn-forget-auto-folder").addEventListener("click", async () => {
  await AutoImport.forgetDirectoryHandle();
  autoImportDirHandle = null;
  autoImportNeedsReauth = false;
  renderAutoImportStatus();
  toast("Pasta desvinculada. Os extratos já importados continuam salvos.");
});

async function initAutoImportFolder() {
  if (!AutoImport.isSupported()) { renderAutoImportStatus(); return; }
  const handle = await AutoImport.loadDirectoryHandle().catch(() => null);
  if (!handle) { renderAutoImportStatus(); return; }
  autoImportDirHandle = handle;
  await runAutoImportScan(handle, { requestPermission: false });
}

// ---- exportar CSV ----
function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

$("#btn-export-tx-csv").addEventListener("click", () => {
  const list = getFilteredSortedTransactions();
  const header = "Data,Descricao,Categoria,Conta,Tipo,Valor";
  const rows = list.map((t) => [
    formatDateBR(t.date), csvEscape(t.description), csvEscape(t.category), csvEscape(accountLabel(t)), t.type, t.amount.toFixed(2),
  ].join(","));
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transacoes-${todayMonthKey()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ============================================================
// CONTAS
// ============================================================
function renderAccounts() {
  const state = Store.get();
  const { accounts } = state;
  $("#accounts-list").innerHTML = accounts.map((a) => {
    const balance = accountBalance(state, a.id);
    const isCard = a.type === "cartao_credito";
    const invoices = isCard ? creditCardInvoices(state, a.id).slice(0, 3) : [];
    return `
      <div class="card account-card" data-id="${a.id}">
        <span class="account-type">${ACCOUNT_TYPE_LABELS[a.type] || a.type}</span>
        <h3>${escapeHtml(a.name)}</h3>
        <span class="account-balance ${balance < 0 ? "negative" : ""}">${formatCurrency(balance)}</span>
        ${isCard ? `<div class="invoices">${invoices.length > 0
          ? invoices.map((inv) => `<div class="invoice-row"><span>${monthLabel(inv.month)}</span><span>${formatCurrency(inv.total)}</span></div>`).join("")
          : '<p class="muted">Sem lançamentos ainda.</p>'}</div>` : ""}
        <div class="view-actions" style="margin-top:8px">
          <button class="btn secondary small" data-action="edit-account">Editar</button>
          <button class="btn danger small" data-action="del-account">Excluir</button>
        </div>
      </div>
    `;
  }).join("");
  $("#accounts-empty").hidden = accounts.length > 0;

  const balances = allAccountBalances(state);
  accountsBalanceChart("chart-accounts-2", balances.map((x) => x.account.name), balances.map((x) => x.balance));
}

$("#accounts-list").addEventListener("click", (e) => {
  const card = e.target.closest(".account-card");
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.dataset.action === "edit-account") openAccountModal(id);
  if (e.target.dataset.action === "del-account") {
    const acc = Store.get().accounts.find((a) => a.id === id);
    deleteWithUndo(acc, Store.removeAccount, Store.addAccount, "Conta", () => { renderAccounts(); populateAccountSelects(); renderDashboard(); });
  }
});

function updateAccountFormVisibility() {
  const isCard = $("#account-type").value === "cartao_credito";
  $("#account-closing-label").hidden = !isCard;
  $("#account-due-label").hidden = !isCard;
}
$("#account-type").addEventListener("change", updateAccountFormVisibility);

function openAccountModal(id) {
  const modal = $("#modal-account");
  if (id) {
    const a = Store.get().accounts.find((x) => x.id === id);
    $("#modal-account-title").textContent = "Editar conta";
    $("#account-id").value = a.id;
    $("#account-name").value = a.name;
    $("#account-type").value = a.type;
    $("#account-balance").value = a.initialBalance || 0;
    $("#account-closing").value = a.closingDay || "";
    $("#account-due").value = a.dueDay || "";
  } else {
    $("#modal-account-title").textContent = "Nova conta";
    $("#form-account").reset();
    $("#account-id").value = "";
    $("#account-balance").value = 0;
  }
  updateAccountFormVisibility();
  modal.hidden = false;
}

$("#btn-add-account").addEventListener("click", () => openAccountModal(null));
$("#btn-cancel-account").addEventListener("click", () => { $("#modal-account").hidden = true; });

$("#form-account").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#account-id").value;
  const isCard = $("#account-type").value === "cartao_credito";
  const payload = {
    name: $("#account-name").value.trim(),
    type: $("#account-type").value,
    initialBalance: parseFloat($("#account-balance").value) || 0,
    closingDay: isCard ? (parseInt($("#account-closing").value, 10) || 1) : undefined,
    dueDay: isCard ? (parseInt($("#account-due").value, 10) || 1) : undefined,
  };
  if (id) Store.updateAccount(id, payload);
  else Store.addAccount(payload);
  $("#modal-account").hidden = true;
  renderAccounts();
  populateAccountSelects();
  renderDashboard();
  toast("Conta salva.");
});

// ============================================================
// INVESTIMENTOS
// ============================================================
function renderInvestments() {
  const { investments, settings } = Store.get();
  const totalInvested = investments.reduce((s, i) => s + investedTotal(i), 0);
  const totalCurrent = investments.reduce((s, i) => s + i.currentValue, 0);
  const totalProceeds = investments.reduce((s, i) => s + proceedsTotal(i), 0);
  const gain = totalCurrent - totalInvested + totalProceeds;
  const gainPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

  $("#inv-summary-cards").innerHTML = `
    <div class="card stat"><span class="stat-label">Total investido</span><span class="stat-value">${formatCurrency(totalInvested)}</span></div>
    <div class="card stat"><span class="stat-label">Valor atual</span><span class="stat-value">${formatCurrency(totalCurrent)}</span></div>
    <div class="card stat"><span class="stat-label">Proventos recebidos</span><span class="stat-value">${formatCurrency(totalProceeds)}</span></div>
    <div class="card stat"><span class="stat-label">Rentabilidade</span><span class="stat-value ${gain >= 0 ? "positive" : "negative"}">${formatCurrency(gain)} (${formatPercent(gainPct)})</span></div>
  `;

  $("#inv-risk-label").textContent = settings.riskProfile;

  const tbody = $("#inv-table-body");
  tbody.innerHTML = investments.map((inv) => {
    const invested = investedTotal(inv);
    const proceeds = proceedsTotal(inv);
    const g = inv.currentValue - invested + proceeds;
    const gp = invested > 0 ? (g / invested) * 100 : 0;
    const cashflows = [
      ...inv.contributions.map((c) => ({ date: c.date, amount: -c.amount })),
      ...(inv.proceeds || []).map((p) => ({ date: p.date, amount: p.amount })),
      { date: new Date().toISOString().slice(0, 10), amount: inv.currentValue },
    ].sort((a, b) => a.date.localeCompare(b.date));
    const rate = xirr(cashflows);
    return `
      <tr data-id="${inv.id}">
        <td>${escapeHtml(inv.name)}</td>
        <td>${escapeHtml(inv.ticker || "—")}</td>
        <td>${CLASS_LABELS[inv.class] || inv.class}</td>
        <td>${liquidityLabel(inv.liquidity)}</td>
        <td class="right">${formatCurrency(invested)}</td>
        <td class="right">${formatCurrency(inv.currentValue)}</td>
        <td class="right">${formatCurrency(proceeds)}</td>
        <td class="right ${g >= 0 ? "amount-income" : "amount-expense"}">${formatCurrency(g)} (${formatPercent(gp)})</td>
        <td class="right">${rate === null ? "—" : formatPercent(rate)}</td>
        <td class="row-actions">
          ${inv.ticker && inv.quantity ? `<button class="btn secondary small" data-action="update-quote">Cotação</button>` : ""}
          <button class="btn secondary small" data-action="add-dividend">Provento</button>
          <button class="btn secondary small" data-action="add-contrib">+ Aporte</button>
          <button class="btn secondary small" data-action="edit-inv">Editar</button>
          <button class="btn danger small" data-action="del-inv">Excluir</button>
        </td>
      </tr>
    `;
  }).join("");
  $("#inv-empty").hidden = investments.length > 0;

  const target = RISK_PROFILES[settings.riskProfile] || RISK_PROFILES.moderado;
  const byClass = {};
  investments.forEach((i) => { byClass[i.class] = (byClass[i.class] || 0) + i.currentValue; });
  const classes = Object.keys(CLASS_LABELS).filter((c) => target[c] !== undefined);
  const actualPct = classes.map((c) => (totalCurrent > 0 ? ((byClass[c] || 0) / totalCurrent) * 100 : 0));
  const targetPct = classes.map((c) => target[c]);
  targetVsActualChart("chart-inv-target", classes.map((c) => CLASS_LABELS[c]), actualPct, targetPct);
}

function liquidityLabel(l) {
  return { alta: "Alta", media: "Média", baixa: "Baixa" }[l] || l;
}

$("#inv-table-body").addEventListener("click", async (e) => {
  const row = e.target.closest("tr");
  if (!row) return;
  const id = row.dataset.id;
  const action = e.target.dataset.action;
  if (action === "edit-inv") openInvModal(id);
  if (action === "add-contrib") openContribModal(id);
  if (action === "add-dividend") openDividendModal(id);
  if (action === "del-inv") {
    const inv = Store.get().investments.find((i) => i.id === id);
    deleteWithUndo(inv, Store.removeInvestment, Store.addInvestment, "Investimento", () => { renderInvestments(); renderDashboard(); });
  }
  if (action === "update-quote") {
    const inv = Store.get().investments.find((i) => i.id === id);
    if (!inv.ticker || !inv.quantity) { toast("Defina ticker e quantidade para cotação automática."); return; }
    toast("Buscando cotação...");
    const price = inv.class === "cripto" ? await fetchCryptoQuote(inv.ticker) : await fetchStockQuote(inv.ticker);
    if (price === null) { toast("Não foi possível obter a cotação agora (sem internet ou serviço indisponível)."); return; }
    Store.updateInvestment(id, { currentValue: Math.round(price * inv.quantity * 100) / 100 });
    renderInvestments();
    renderDashboard();
    toast(`Cotação atualizada: ${formatCurrency(price)} × ${inv.quantity}.`);
  }
});

function openInvModal(id) {
  const modal = $("#modal-inv");
  const isEdit = Boolean(id);
  $("#inv-date-label").hidden = isEdit;
  $("#inv-invested-label").hidden = isEdit;
  $("#inv-date").required = !isEdit;
  $("#inv-invested").required = !isEdit;

  if (id) {
    const inv = Store.get().investments.find((i) => i.id === id);
    $("#modal-inv-title").textContent = "Editar investimento";
    $("#inv-id").value = inv.id;
    $("#inv-name").value = inv.name;
    $("#inv-ticker").value = inv.ticker || "";
    $("#inv-quantity").value = inv.quantity || "";
    $("#inv-class").value = inv.class;
    $("#inv-liquidity").value = inv.liquidity;
    $("#inv-current").value = inv.currentValue;
  } else {
    $("#modal-inv-title").textContent = "Novo investimento";
    $("#form-inv").reset();
    $("#inv-id").value = "";
    $("#inv-date").value = new Date().toISOString().slice(0, 10);
  }
  modal.hidden = false;
}

$("#btn-add-inv").addEventListener("click", () => openInvModal(null));
$("#btn-cancel-inv").addEventListener("click", () => { $("#modal-inv").hidden = true; });

$("#form-inv").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#inv-id").value;
  const shared = {
    name: $("#inv-name").value.trim(),
    ticker: $("#inv-ticker").value.trim(),
    quantity: parseFloat($("#inv-quantity").value) || undefined,
    class: $("#inv-class").value,
    liquidity: $("#inv-liquidity").value,
    currentValue: parseFloat($("#inv-current").value),
  };
  if (id) {
    Store.updateInvestment(id, shared);
  } else {
    Store.addInvestment({ ...shared, contributions: [{ date: $("#inv-date").value, amount: parseFloat($("#inv-invested").value) }] });
  }
  $("#modal-inv").hidden = true;
  renderInvestments();
  renderDashboard();
  renderOpportunitiesView();
  toast("Investimento salvo.");
});

function openContribModal(investmentId) {
  $("#contrib-inv-id").value = investmentId;
  $("#contrib-date").value = new Date().toISOString().slice(0, 10);
  $("#contrib-amount").value = "";
  $("#modal-contribution").hidden = false;
}
$("#btn-cancel-contrib").addEventListener("click", () => { $("#modal-contribution").hidden = true; });
$("#form-contribution").addEventListener("submit", (e) => {
  e.preventDefault();
  Store.addContribution($("#contrib-inv-id").value, {
    date: $("#contrib-date").value,
    amount: parseFloat($("#contrib-amount").value),
  });
  $("#modal-contribution").hidden = true;
  renderInvestments();
  renderDashboard();
  toast("Aporte registrado.");
});

function openDividendModal(investmentId) {
  $("#dividend-inv-id").value = investmentId;
  $("#dividend-date").value = new Date().toISOString().slice(0, 10);
  $("#dividend-amount").value = "";
  $("#dividend-description").value = "";
  $("#modal-dividend").hidden = false;
}
$("#btn-cancel-dividend").addEventListener("click", () => { $("#modal-dividend").hidden = true; });
$("#form-dividend").addEventListener("submit", (e) => {
  e.preventDefault();
  Store.addProceed($("#dividend-inv-id").value, {
    date: $("#dividend-date").value,
    amount: parseFloat($("#dividend-amount").value),
    description: $("#dividend-description").value.trim(),
  });
  $("#modal-dividend").hidden = true;
  renderInvestments();
  renderOpportunitiesView();
  toast("Provento registrado.");
});

// ============================================================
// DÍVIDAS (empréstimos/financiamentos)
// ============================================================
function renderLoans() {
  const { loans } = Store.get();
  $("#loans-summary-cards").innerHTML = `
    <div class="card stat"><span class="stat-label">Saldo devedor total</span><span class="stat-value negative">${formatCurrency(totalLoansRemaining(loans))}</span></div>
  `;
  $("#loans-table-body").innerHTML = loans.map((l) => {
    const payment = loanMonthlyPayment(l);
    const balance = remainingBalance(l);
    return `
      <tr data-id="${l.id}">
        <td>${escapeHtml(l.name)}</td>
        <td class="right">${formatCurrency(l.principal)}</td>
        <td class="right">${formatPercent(l.annualRatePct)}</td>
        <td class="right">${formatCurrency(payment)}</td>
        <td>${l.paidInstallments || 0} / ${l.installmentsTotal}</td>
        <td class="right">${formatCurrency(balance)}</td>
        <td class="row-actions">
          <button class="btn secondary small" data-action="pay-loan" ${balance <= 0 ? "disabled" : ""}>Registrar pagamento</button>
          <button class="btn secondary small" data-action="edit-loan">Editar</button>
          <button class="btn danger small" data-action="del-loan">Excluir</button>
        </td>
      </tr>
    `;
  }).join("");
  $("#loans-empty").hidden = loans.length > 0;
}

$("#loans-table-body").addEventListener("click", (e) => {
  const row = e.target.closest("tr");
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.dataset.action === "edit-loan") openLoanModal(id);
  if (e.target.dataset.action === "pay-loan") {
    Store.registerLoanPayment(id);
    renderLoans();
    renderDashboard();
    toast("Pagamento registrado. Lembre-se de lançar a transação/transferência correspondente se quiser refletir no fluxo de caixa.");
  }
  if (e.target.dataset.action === "del-loan") {
    const loan = Store.get().loans.find((l) => l.id === id);
    deleteWithUndo(loan, Store.removeLoan, Store.addLoan, "Empréstimo", () => { renderLoans(); renderDashboard(); });
  }
});

function openLoanModal(id) {
  const modal = $("#modal-loan");
  if (id) {
    const l = Store.get().loans.find((x) => x.id === id);
    $("#modal-loan-title").textContent = "Editar empréstimo";
    $("#loan-id").value = l.id;
    $("#loan-name").value = l.name;
    $("#loan-principal").value = l.principal;
    $("#loan-rate").value = l.annualRatePct;
    $("#loan-installments").value = l.installmentsTotal;
    $("#loan-paid").value = l.paidInstallments || 0;
    $("#loan-start").value = l.startDate;
  } else {
    $("#modal-loan-title").textContent = "Novo empréstimo";
    $("#form-loan").reset();
    $("#loan-id").value = "";
    $("#loan-paid").value = 0;
    $("#loan-start").value = new Date().toISOString().slice(0, 10);
  }
  modal.hidden = false;
}

$("#btn-add-loan").addEventListener("click", () => openLoanModal(null));
$("#btn-cancel-loan").addEventListener("click", () => { $("#modal-loan").hidden = true; });

$("#form-loan").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#loan-id").value;
  const payload = {
    name: $("#loan-name").value.trim(),
    principal: parseFloat($("#loan-principal").value),
    annualRatePct: parseFloat($("#loan-rate").value),
    installmentsTotal: parseInt($("#loan-installments").value, 10),
    paidInstallments: parseInt($("#loan-paid").value, 10) || 0,
    startDate: $("#loan-start").value,
  };
  if (id) Store.updateLoan(id, payload);
  else Store.addLoan(payload);
  $("#modal-loan").hidden = true;
  renderLoans();
  renderDashboard();
  renderOpportunitiesView();
  toast("Empréstimo salvo.");
});

// ============================================================
// METAS
// ============================================================
function renderGoals() {
  const { goals } = Store.get();
  const list = $("#goals-list");
  list.innerHTML = goals.map((g) => {
    const pct = g.targetAmount > 0 ? Math.min(100, (g.savedAmount / g.targetAmount) * 100) : 0;
    const barClass = pct >= 100 ? "" : pct > 80 ? "warning" : "";
    let suggestion = "";
    if (g.targetDate && pct < 100) {
      const monthsLeft = Math.max(1, Math.round((new Date(g.targetDate) - new Date()) / (1000 * 60 * 60 * 24 * 30)));
      const needed = (g.targetAmount - g.savedAmount) / monthsLeft;
      if (needed > 0) suggestion = `<p class="muted">Guarde ~${formatCurrency(needed)}/mês para chegar lá até a data alvo.</p>`;
    }
    return `
      <div class="card" data-id="${g.id}">
        <h3>${escapeHtml(g.name)}</h3>
        <p class="muted">${formatCurrency(g.savedAmount)} de ${formatCurrency(g.targetAmount)}${g.targetDate ? ` · até ${formatDateBR(g.targetDate)}` : ""}</p>
        <div class="progress-bar" style="height:12px"><div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div></div>
        ${suggestion}
        <div class="view-actions" style="margin-top:12px">
          <button class="btn secondary small" data-action="add-to-goal">+ Guardar valor</button>
          <button class="btn secondary small" data-action="edit-goal">Editar</button>
          <button class="btn danger small" data-action="del-goal">Excluir</button>
        </div>
      </div>
    `;
  }).join("");
  $("#goals-empty").hidden = goals.length > 0;
}

$("#goals-list").addEventListener("click", (e) => {
  const card = e.target.closest(".card[data-id]");
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.dataset.action === "edit-goal") openGoalModal(id);
  if (e.target.dataset.action === "del-goal") {
    const goal = Store.get().goals.find((g) => g.id === id);
    deleteWithUndo(goal, Store.removeGoal, Store.addGoal, "Meta", renderGoals);
  }
  if (e.target.dataset.action === "add-to-goal") {
    const goal = Store.get().goals.find((g) => g.id === id);
    const raw = prompt(`Quanto deseja guardar a mais para "${goal.name}"?`, "0");
    const value = parseFloat((raw || "").replace(",", "."));
    if (!Number.isNaN(value) && value !== 0) {
      Store.updateGoal(id, { savedAmount: Math.max(0, goal.savedAmount + value) });
      renderGoals();
      toast("Meta atualizada.");
    }
  }
});

function openGoalModal(id) {
  const modal = $("#modal-goal");
  if (id) {
    const g = Store.get().goals.find((x) => x.id === id);
    $("#modal-goal-title").textContent = "Editar meta";
    $("#goal-id").value = g.id;
    $("#goal-name").value = g.name;
    $("#goal-target").value = g.targetAmount;
    $("#goal-date").value = g.targetDate || "";
    $("#goal-saved").value = g.savedAmount;
  } else {
    $("#modal-goal-title").textContent = "Nova meta";
    $("#form-goal").reset();
    $("#goal-id").value = "";
    $("#goal-saved").value = 0;
  }
  modal.hidden = false;
}

$("#btn-add-goal").addEventListener("click", () => openGoalModal(null));
$("#btn-cancel-goal").addEventListener("click", () => { $("#modal-goal").hidden = true; });

$("#form-goal").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#goal-id").value;
  const payload = {
    name: $("#goal-name").value.trim(),
    targetAmount: parseFloat($("#goal-target").value),
    targetDate: $("#goal-date").value || null,
    savedAmount: parseFloat($("#goal-saved").value) || 0,
  };
  if (id) Store.updateGoal(id, payload);
  else Store.addGoal(payload);
  $("#modal-goal").hidden = true;
  renderGoals();
  toast("Meta salva.");
});

// ============================================================
// ORÇAMENTO + CONTAS FIXAS
// ============================================================
function effectiveBudgetLimit(budget, month) {
  if (!budget) return 0;
  if (!budget.rollover) return budget.monthlyLimit;
  const prevMonth = addMonths(month, -1);
  const { transactions } = Store.get();
  const prevSpent = transactions.filter((t) => t.type === "expense" && monthKey(t.date) === prevMonth)
    .flatMap(categoryBreakdown).filter((s) => s.category === budget.category)
    .reduce((s, x) => s + x.amount, 0);
  const leftover = Math.max(0, budget.monthlyLimit - prevSpent);
  return budget.monthlyLimit + leftover;
}

function renderBudget() {
  const { settings, budgets, transactions } = Store.get();
  const month = $("#budget-filter-month").value || todayMonthKey();
  $("#budget-filter-month").value = month;

  const spentByCategory = {};
  transactions.filter((t) => t.type === "expense" && monthKey(t.date) === month)
    .flatMap(categoryBreakdown)
    .forEach((s) => { spentByCategory[s.category] = (spentByCategory[s.category] || 0) + s.amount; });

  const tbody = $("#budget-table-body");
  tbody.innerHTML = settings.expenseCategories.map((cat) => {
    const budget = budgets.find((b) => b.category === cat);
    const baseLimit = budget ? budget.monthlyLimit : 0;
    const limit = budget ? effectiveBudgetLimit(budget, month) : 0;
    const spent = spentByCategory[cat] || 0;
    const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
    const barClass = limit === 0 ? "" : spent > limit ? "over" : pct > 80 ? "warning" : "";
    const rolloverNote = budget && budget.rollover && limit !== baseLimit
      ? `<div class="muted" style="font-size:0.75rem">Com rollover: ${formatCurrency(limit)}</div>` : "";
    return `
      <tr data-category="${escapeHtml(cat)}">
        <td>${escapeHtml(cat)}</td>
        <td class="right">
          <input type="number" min="0" step="0.01" class="budget-limit-input" value="${baseLimit || ""}" placeholder="0,00" style="width:110px">
          ${rolloverNote}
        </td>
        <td class="right">${formatCurrency(spent)}</td>
        <td><div class="progress-bar"><div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div></div></td>
        <td><input type="checkbox" class="budget-rollover-input" ${budget && budget.rollover ? "checked" : ""}></td>
        <td><button class="btn secondary small" data-action="save-budget">Salvar</button></td>
      </tr>
    `;
  }).join("");

  populateBudgetHistorySelect();
  renderBudgetHistory();
}

$("#budget-filter-month").addEventListener("change", renderBudget);

$("#budget-table-body").addEventListener("click", (e) => {
  if (e.target.dataset.action !== "save-budget") return;
  const row = e.target.closest("tr");
  const category = row.dataset.category;
  const value = parseFloat(row.querySelector(".budget-limit-input").value) || 0;
  const rollover = row.querySelector(".budget-rollover-input").checked;
  Store.setBudget(category, value, rollover);
  renderBudget();
  renderOpportunitiesView();
  toast("Orçamento atualizado.");
});

function populateBudgetHistorySelect() {
  const sel = $("#budget-history-category");
  const { settings } = Store.get();
  const current = sel.value;
  sel.innerHTML = settings.expenseCategories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (settings.expenseCategories.includes(current)) sel.value = current;
}

function renderBudgetHistory() {
  const { settings, budgets, transactions } = Store.get();
  const category = $("#budget-history-category").value || settings.expenseCategories[0];
  if (!category) return;
  const months = lastNMonths(6);
  const budget = budgets.find((b) => b.category === category);
  const budgeted = months.map((m) => (budget ? effectiveBudgetLimit(budget, m) : 0));
  const actual = months.map((m) => transactions.filter((t) => t.type === "expense" && monthKey(t.date) === m)
    .flatMap(categoryBreakdown).filter((s) => s.category === category).reduce((s, x) => s + x.amount, 0));
  budgetHistoryChart("chart-budget-history", months.map((m) => monthLabel(m).split(" de")[0]), budgeted, actual);
}
$("#budget-history-category").addEventListener("change", renderBudgetHistory);

function renderBills() {
  const { bills } = Store.get();
  const tbody = $("#bills-table-body");
  tbody.innerHTML = bills.map((b) => `
    <tr data-id="${b.id}">
      <td>${escapeHtml(b.name)}</td>
      <td>${escapeHtml(b.category)}</td>
      <td class="right">${formatCurrency(b.amount)}</td>
      <td>Dia ${b.dueDay}</td>
      <td>${b.autoGenerate ? "Sim" : "Não"}</td>
      <td class="row-actions">
        <button class="btn secondary small" data-action="edit-bill">Editar</button>
        <button class="btn danger small" data-action="del-bill">Excluir</button>
      </td>
    </tr>
  `).join("");
  $("#bills-empty").hidden = bills.length > 0;
}

$("#bills-table-body").addEventListener("click", (e) => {
  const row = e.target.closest("tr");
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.dataset.action === "edit-bill") openBillModal(id);
  if (e.target.dataset.action === "del-bill") {
    const bill = Store.get().bills.find((b) => b.id === id);
    deleteWithUndo(bill, Store.removeBill, Store.addBill, "Conta fixa", () => { renderBills(); renderOpportunitiesView(); });
  }
});

function openBillModal(id) {
  populateCategorySelects();
  populateAccountSelects();
  const modal = $("#modal-bill");
  if (id) {
    const b = Store.get().bills.find((x) => x.id === id);
    $("#modal-bill-title").textContent = "Editar conta fixa";
    $("#bill-id").value = b.id;
    $("#bill-name").value = b.name;
    $("#bill-category").value = b.category;
    $("#bill-amount").value = b.amount;
    $("#bill-due-day").value = b.dueDay;
    $("#bill-account").value = b.accountId || "";
    $("#bill-auto-generate").checked = Boolean(b.autoGenerate);
  } else {
    $("#modal-bill-title").textContent = "Nova conta fixa";
    $("#form-bill").reset();
    $("#bill-id").value = "";
    populateCategorySelects();
  }
  modal.hidden = false;
}

$("#btn-add-bill").addEventListener("click", () => openBillModal(null));
$("#btn-cancel-bill").addEventListener("click", () => { $("#modal-bill").hidden = true; });

$("#form-bill").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#bill-id").value;
  const payload = {
    name: $("#bill-name").value.trim(),
    category: $("#bill-category").value,
    amount: parseFloat($("#bill-amount").value),
    dueDay: parseInt($("#bill-due-day").value, 10),
    accountId: $("#bill-account").value,
    autoGenerate: $("#bill-auto-generate").checked,
  };
  if (id) Store.updateBill(id, payload);
  else Store.addBill(payload);
  $("#modal-bill").hidden = true;
  renderBills();
  renderOpportunitiesView();
  toast("Conta fixa salva.");
});

// ============================================================
// OPORTUNIDADES + FIRE
// ============================================================
const OPPORTUNITY_LEVEL_LABELS = { critical: "Crítico", warning: "Atenção", info: "Info", positive: "Oportunidade" };

function renderOpportunityCards(list) {
  if (list.length === 0) return `<p class="empty-opportunities">Nenhum alerta no momento.</p>`;
  return list.map((o) => `
    <div class="opportunity level-${o.level}">
      <div class="opportunity-head">
        <span class="opportunity-chip level-${o.level}">${OPPORTUNITY_LEVEL_LABELS[o.level] || o.level}</span>
      </div>
      <div class="opportunity-title">${escapeHtml(o.title)}</div>
      <div class="opportunity-desc">${escapeHtml(o.desc)}</div>
    </div>
  `).join("");
}

function renderFire() {
  const { settings } = Store.get();
  $("#fire-withdrawal-rate").value = settings.fireWithdrawalRate;
  $("#fire-expected-return").value = settings.fireExpectedReturn;

  const fire = computeFireProjection(Store.get());
  $("#fire-summary-cards").innerHTML = `
    <div class="card stat"><span class="stat-label">Gasto médio anual</span><span class="stat-value">${formatCurrency(fire.avgExpense * 12)}</span></div>
    <div class="card stat"><span class="stat-label">Número FIRE (patrimônio alvo)</span><span class="stat-value">${formatCurrency(fire.fireNumber)}</span></div>
    <div class="card stat"><span class="stat-label">Patrimônio atual</span><span class="stat-value">${formatCurrency(fire.currentNetWorth)}</span></div>
    <div class="card stat"><span class="stat-label">Tempo estimado</span><span class="stat-value">${fire.years === null ? "—" : fire.years < 1 ? "menos de 1 ano" : `${fire.years.toFixed(1)} anos`}</span></div>
  `;
  $("#fire-progress-bar").style.width = `${fire.progressPct}%`;
}

$("#fire-withdrawal-rate").addEventListener("change", () => {
  Store.updateSettings({ fireWithdrawalRate: parseFloat($("#fire-withdrawal-rate").value) || 4 });
  renderFire();
});
$("#fire-expected-return").addEventListener("change", () => {
  Store.updateSettings({ fireExpectedReturn: parseFloat($("#fire-expected-return").value) || 6 });
  renderFire();
});

function renderOpportunitiesView() {
  const opps = computeOpportunities(Store.get());
  $("#opportunities-full-list").innerHTML = renderOpportunityCards(opps);
  renderFire();
}

// ============================================================
// CONFIGURAÇÕES
// ============================================================
function renderSettings() {
  const { settings } = Store.get();
  $("#cfg-risk-profile").value = settings.riskProfile;
  $("#cfg-emergency-months").value = settings.emergencyMonths;
  $("#cfg-expense-categories").value = settings.expenseCategories.join(", ");
  $("#cfg-income-categories").value = settings.incomeCategories.join(", ");
  $("#cfg-theme").value = settings.theme;
  $("#btn-remove-pin").hidden = !settings.pinHash;
  renderRules();
  renderAutoImportStatus();
}

function renderRules() {
  const { categoryRules } = Store.get();
  $("#rules-table-body").innerHTML = categoryRules.map((r) => `
    <tr data-id="${r.id}">
      <td>${escapeHtml(r.keyword)}</td>
      <td>${r.type === "income" ? "Receita" : "Despesa"}</td>
      <td>${escapeHtml(r.category)}</td>
      <td class="row-actions">
        <button class="btn secondary small" data-action="edit-rule">Editar</button>
        <button class="btn danger small" data-action="del-rule">Excluir</button>
      </td>
    </tr>
  `).join("");
}

$("#rules-table-body").addEventListener("click", (e) => {
  const row = e.target.closest("tr");
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.dataset.action === "del-rule") {
    const rule = Store.get().categoryRules.find((r) => r.id === id);
    deleteWithUndo(rule, Store.removeCategoryRule, Store.addCategoryRule, "Regra", renderRules);
  }
  if (e.target.dataset.action === "edit-rule") {
    const rule = Store.get().categoryRules.find((r) => r.id === id);
    $("#rule-keyword").value = rule.keyword;
    $("#rule-type").value = rule.type;
    populateCategorySelects();
    $("#rule-category").value = rule.category;
    editingRuleId = id;
    $("#btn-add-rule").textContent = "Salvar edição";
  }
});

$("#btn-add-rule").addEventListener("click", () => {
  const keyword = $("#rule-keyword").value.trim();
  if (!keyword) { toast("Informe uma palavra-chave."); return; }
  const payload = { keyword, type: $("#rule-type").value, category: $("#rule-category").value };
  if (editingRuleId) {
    Store.updateCategoryRule(editingRuleId, payload);
    editingRuleId = null;
    $("#btn-add-rule").textContent = "+ Adicionar regra";
  } else {
    Store.addCategoryRule(payload);
  }
  $("#rule-keyword").value = "";
  renderRules();
  toast("Regra salva.");
});

$("#cfg-theme").addEventListener("change", () => {
  Store.updateSettings({ theme: $("#cfg-theme").value });
  applyTheme();
});

$("#btn-set-pin").addEventListener("click", async () => {
  const pin = $("#cfg-pin-new").value.trim();
  if (!/^[0-9]{4,6}$/.test(pin)) { toast("O PIN deve ter de 4 a 6 dígitos numéricos."); return; }
  const hash = await sha256Hex(pin);
  Store.updateSettings({ pinHash: hash });
  $("#cfg-pin-new").value = "";
  renderSettings();
  toast("PIN definido. Ele será solicitado na próxima vez que o app for aberto.");
});
$("#btn-remove-pin").addEventListener("click", () => {
  Store.updateSettings({ pinHash: null });
  renderSettings();
  toast("PIN removido.");
});

$("#cfg-risk-profile").addEventListener("change", () => {
  Store.updateSettings({ riskProfile: $("#cfg-risk-profile").value });
  renderInvestments();
  renderOpportunitiesView();
  renderDashboard();
});

$("#cfg-emergency-months").addEventListener("change", () => {
  const v = parseInt($("#cfg-emergency-months").value, 10) || 6;
  Store.updateSettings({ emergencyMonths: v });
  renderOpportunitiesView();
  renderDashboard();
});

$("#btn-save-categories").addEventListener("click", () => {
  const expList = $("#cfg-expense-categories").value.split(",").map((s) => s.trim()).filter(Boolean);
  const incList = $("#cfg-income-categories").value.split(",").map((s) => s.trim()).filter(Boolean);
  if (expList.length === 0 || incList.length === 0) { toast("As listas de categorias não podem ficar vazias."); return; }
  Store.updateSettings({ expenseCategories: expList, incomeCategories: incList });
  renderBudget();
  populateCategorySelects();
  toast("Categorias salvas.");
});

$("#btn-export-json").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(Store.get(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `financas-backup-${todayMonthKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$("#btn-import-json").addEventListener("click", () => $("#file-json").click());
$("#file-json").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    Store.replaceAll(data);
    renderAll();
    toast("Backup importado com sucesso.");
  } catch (err) {
    toast("Arquivo inválido.");
  }
  e.target.value = "";
});

$("#btn-reset-data").addEventListener("click", () => {
  if (confirm("Isso vai apagar TODOS os dados salvos neste navegador. Continuar?")) {
    Store.resetAll();
    renderAll();
    toast("Dados apagados.");
  }
});

// ============================================================
// helpers
// ============================================================
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderAll() {
  populateCategorySelects();
  populateAccountSelects();
  renderDashboard();
  renderTransactions();
  renderAccounts();
  renderInvestments();
  renderLoans();
  renderGoals();
  renderBudget();
  renderBills();
  renderOpportunitiesView();
  renderSettings();
}

$("#tx-filter-month").value = todayMonthKey();
$("#budget-filter-month").value = todayMonthKey();

Store.onChange(() => {}); // reservado para reatividade futura entre views

// ============================================================
// bloqueio por PIN + inicialização
// ============================================================
function generateRecurring() {
  const { newTransactions, billUpdates } = computeDueTransactions(Store.get());
  if (newTransactions.length > 0) {
    Store.applyGeneratedTransactions(newTransactions, billUpdates);
  }
}

function init() {
  applyTheme();
  generateRecurring();
  renderAll();
  initAutoImportFolder();
}

function showApp() {
  $("#lock-screen").hidden = true;
  $("#app-root").hidden = false;
  init();
}

async function checkPin(pin) {
  const { settings } = Store.get();
  const hash = await sha256Hex(pin);
  return hash === settings.pinHash;
}

$("#form-unlock").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = await checkPin($("#unlock-pin").value);
  if (ok) {
    $("#unlock-error").hidden = true;
    $("#unlock-pin").value = "";
    showApp();
  } else {
    $("#unlock-error").hidden = false;
  }
});

if (Store.get().settings.pinHash) {
  $("#lock-screen").hidden = false;
} else {
  showApp();
}
