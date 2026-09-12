import { Store, investedTotal } from "./storage.js";
import {
  formatCurrency, formatPercent, monthKey, todayMonthKey, addMonths, monthLabel,
  lastNMonths, CLASS_LABELS, RISK_PROFILES, uniqueSorted, xirr,
} from "./utils.js";
import { parseCSV, guessMapping, rowsToTransactions } from "./csv-import.js";
import { parseOFX } from "./ofx-import.js";
import { computeOpportunities, computeFireProjection } from "./advisor.js";
import { applyCategoryRules } from "./categorize.js";
import { cashflowChart, allocationChart, categoriesChart, targetVsActualChart, netWorthChart } from "./charts.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let dashMonth = todayMonthKey();
let csvStaging = null; // { headers, rows, mapping }

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
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2800);
}

// ---------- category selects ----------
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
}

$("#tx-type").addEventListener("change", populateCategorySelects);
$("#rule-type").addEventListener("change", populateCategorySelects);

$("#tx-description").addEventListener("blur", () => {
  const { categoryRules } = Store.get();
  const suggested = applyCategoryRules($("#tx-description").value, $("#tx-type").value, categoryRules);
  if (suggested) $("#tx-category").value = suggested;
});

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const { transactions, investments, netWorthHistory } = Store.get();
  $("#dash-month-label").textContent = monthLabel(dashMonth);

  const monthTx = transactions.filter((t) => monthKey(t.date) === dashMonth);
  const income = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const totalInvested = investments.reduce((s, i) => s + i.currentValue, 0);

  $("#stat-income").textContent = formatCurrency(income);
  $("#stat-expense").textContent = formatCurrency(expense);
  const balanceEl = $("#stat-balance");
  balanceEl.textContent = formatCurrency(income - expense);
  balanceEl.className = "stat-value " + (income - expense >= 0 ? "positive" : "negative");
  $("#stat-networth").textContent = formatCurrency(totalInvested);

  const months = lastNMonths(6, dashMonth);
  const labels = months.map((m) => monthLabel(m).split(" de")[0]);
  const incomeSeries = months.map((m) => transactions.filter((t) => t.type === "income" && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0));
  const expenseSeries = months.map((m) => transactions.filter((t) => t.type === "expense" && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0));
  cashflowChart("chart-cashflow", months, labels, incomeSeries, expenseSeries);

  const byClass = {};
  investments.forEach((i) => { byClass[i.class] = (byClass[i.class] || 0) + i.currentValue; });
  const allocLabels = Object.keys(byClass).map((k) => CLASS_LABELS[k] || k);
  allocationChart("chart-allocation", allocLabels, Object.values(byClass));

  const byCat = {};
  monthTx.filter((t) => t.type === "expense").forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  categoriesChart("chart-categories", sortedCats.map((c) => c[0]), sortedCats.map((c) => c[1]));

  const opps = computeOpportunities(Store.get());
  $("#dash-opportunities-list").innerHTML = renderOpportunityCards(opps.slice(0, 3));

  const historySorted = netWorthHistory.slice().sort((a, b) => a.month.localeCompare(b.month));
  netWorthChart("chart-networth", historySorted.map((h) => monthLabel(h.month).split(" de")[0]), historySorted.map((h) => h.netWorth));
}

$("#dash-prev-month").addEventListener("click", () => { dashMonth = addMonths(dashMonth, -1); renderDashboard(); });
$("#dash-next-month").addEventListener("click", () => { dashMonth = addMonths(dashMonth, 1); renderDashboard(); });

// ============================================================
// TRANSAÇÕES
// ============================================================
function renderTransactions() {
  const { transactions } = Store.get();
  const filterMonth = $("#tx-filter-month").value;
  const filterCat = $("#tx-filter-category").value;

  let list = transactions.slice().sort((a, b) => b.date.localeCompare(a.date));
  if (filterMonth) list = list.filter((t) => monthKey(t.date) === filterMonth);
  if (filterCat) list = list.filter((t) => t.category === filterCat);

  const tbody = $("#tx-table-body");
  tbody.innerHTML = list.map((t) => `
    <tr data-id="${t.id}">
      <td>${formatDateBR(t.date)}</td>
      <td>${escapeHtml(t.description)}</td>
      <td>${escapeHtml(t.category)}</td>
      <td>${escapeHtml(t.account || "")}</td>
      <td class="right amount-${t.type}">${t.type === "expense" ? "-" : "+"} ${formatCurrency(t.amount)}</td>
      <td class="row-actions">
        <button class="btn secondary small" data-action="edit-tx">Editar</button>
        <button class="btn danger small" data-action="del-tx">Excluir</button>
      </td>
    </tr>
  `).join("");

  $("#tx-empty").hidden = list.length > 0;
}

$("#tx-filter-month").addEventListener("change", renderTransactions);
$("#tx-filter-category").addEventListener("change", renderTransactions);

$("#tx-table-body").addEventListener("click", (e) => {
  const row = e.target.closest("tr");
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.dataset.action === "edit-tx") openTxModal(id);
  if (e.target.dataset.action === "del-tx") {
    if (confirm("Excluir esta transação?")) { Store.removeTransaction(id); renderTransactions(); renderDashboard(); }
  }
});

function openTxModal(id) {
  populateCategorySelects();
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
    $("#tx-account").value = tx.account || "";
    $("#tx-amount").value = tx.amount;
  } else {
    $("#modal-tx-title").textContent = "Nova transação";
    $("#form-tx").reset();
    $("#tx-id").value = "";
    $("#tx-date").value = new Date().toISOString().slice(0, 10);
    populateCategorySelects();
  }
  modal.hidden = false;
}

$("#btn-add-tx").addEventListener("click", () => openTxModal(null));
$("#btn-cancel-tx").addEventListener("click", () => { $("#modal-tx").hidden = true; });

$("#form-tx").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#tx-id").value;
  const payload = {
    type: $("#tx-type").value,
    date: $("#tx-date").value,
    description: $("#tx-description").value.trim(),
    category: $("#tx-category").value,
    account: $("#tx-account").value.trim(),
    amount: parseFloat($("#tx-amount").value),
  };
  if (id) Store.updateTransaction(id, payload);
  else Store.addTransaction(payload);
  $("#modal-tx").hidden = true;
  renderTransactions();
  renderDashboard();
  renderBudget();
  renderOpportunitiesView();
  toast("Transação salva.");
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
  const fieldNames = { date: "Data", description: "Descrição", amount: "Valor" };
  const mappingHtml = Object.keys(fieldNames).map((field) => `
    <label>${fieldNames[field]}
      <select data-field="${field}">
        ${headers.map((h, i) => `<option value="${i}" ${mapping[field] === i ? "selected" : ""}>${escapeHtml(h)}</option>`).join("")}
      </select>
    </label>
  `).join("");
  $("#csv-mapping").innerHTML = mappingHtml;
  $$('#csv-mapping select').forEach((sel) => sel.addEventListener("change", () => {
    csvStaging.mapping[sel.dataset.field] = parseInt(sel.value, 10);
  }));

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

$("#btn-confirm-csv").addEventListener("click", () => {
  if (!csvStaging) return;
  const { rows, mapping } = csvStaging;
  if (mapping.date < 0 || mapping.amount < 0) { toast("Selecione ao menos as colunas de data e valor."); return; }
  const txs = withAutoCategory(rowsToTransactions(rows, mapping));
  if (txs.length === 0) { toast("Nenhuma transação válida encontrada no arquivo."); return; }
  Store.addTransactions(txs);
  $("#modal-csv").hidden = true;
  csvStaging = null;
  renderTransactions();
  renderDashboard();
  toast(`${txs.length} transações importadas.`);
});

// ---- OFX import ----
$("#btn-import-ofx").addEventListener("click", () => $("#file-ofx").click());

$("#file-ofx").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const txs = withAutoCategory(parseOFX(text));
  if (txs.length === 0) { toast("Nenhuma transação encontrada no arquivo OFX."); }
  else {
    Store.addTransactions(txs);
    renderTransactions();
    renderDashboard();
    toast(`${txs.length} transações importadas do OFX.`);
  }
  e.target.value = "";
});

// ============================================================
// INVESTIMENTOS
// ============================================================
function renderInvestments() {
  const { investments, settings } = Store.get();
  const totalInvested = investments.reduce((s, i) => s + investedTotal(i), 0);
  const totalCurrent = investments.reduce((s, i) => s + i.currentValue, 0);
  const gain = totalCurrent - totalInvested;
  const gainPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

  $("#inv-summary-cards").innerHTML = `
    <div class="card stat"><span class="stat-label">Total investido</span><span class="stat-value">${formatCurrency(totalInvested)}</span></div>
    <div class="card stat"><span class="stat-label">Valor atual</span><span class="stat-value">${formatCurrency(totalCurrent)}</span></div>
    <div class="card stat"><span class="stat-label">Rentabilidade</span><span class="stat-value ${gain >= 0 ? "positive" : "negative"}">${formatCurrency(gain)} (${formatPercent(gainPct)})</span></div>
  `;

  $("#inv-risk-label").textContent = settings.riskProfile;

  const tbody = $("#inv-table-body");
  tbody.innerHTML = investments.map((inv) => {
    const invested = investedTotal(inv);
    const g = inv.currentValue - invested;
    const gp = invested > 0 ? (g / invested) * 100 : 0;
    const cashflows = [...inv.contributions.map((c) => ({ date: c.date, amount: -c.amount })), { date: new Date().toISOString().slice(0, 10), amount: inv.currentValue }];
    const rate = xirr(cashflows);
    return `
      <tr data-id="${inv.id}">
        <td>${escapeHtml(inv.name)}</td>
        <td>${CLASS_LABELS[inv.class] || inv.class}</td>
        <td>${liquidityLabel(inv.liquidity)}</td>
        <td class="right">${formatCurrency(invested)}</td>
        <td class="right">${formatCurrency(inv.currentValue)}</td>
        <td class="right ${g >= 0 ? "amount-income" : "amount-expense"}">${formatCurrency(g)} (${formatPercent(gp)})</td>
        <td class="right">${rate === null ? "—" : formatPercent(rate)}</td>
        <td class="row-actions">
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

$("#inv-table-body").addEventListener("click", (e) => {
  const row = e.target.closest("tr");
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.dataset.action === "edit-inv") openInvModal(id);
  if (e.target.dataset.action === "add-contrib") openContribModal(id);
  if (e.target.dataset.action === "del-inv") {
    if (confirm("Excluir este investimento?")) { Store.removeInvestment(id); renderInvestments(); renderDashboard(); }
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
  if (id) {
    Store.updateInvestment(id, {
      name: $("#inv-name").value.trim(),
      class: $("#inv-class").value,
      liquidity: $("#inv-liquidity").value,
      currentValue: parseFloat($("#inv-current").value),
    });
  } else {
    Store.addInvestment({
      name: $("#inv-name").value.trim(),
      class: $("#inv-class").value,
      liquidity: $("#inv-liquidity").value,
      currentValue: parseFloat($("#inv-current").value),
      contributions: [{ date: $("#inv-date").value, amount: parseFloat($("#inv-invested").value) }],
    });
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

// ============================================================
// METAS
// ============================================================
function renderGoals() {
  const { goals } = Store.get();
  const list = $("#goals-list");
  list.innerHTML = goals.map((g) => {
    const pct = g.targetAmount > 0 ? Math.min(100, (g.savedAmount / g.targetAmount) * 100) : 0;
    const barClass = pct >= 100 ? "" : pct > 80 ? "warning" : "";
    return `
      <div class="card" data-id="${g.id}">
        <h3>${escapeHtml(g.name)}</h3>
        <p class="muted">${formatCurrency(g.savedAmount)} de ${formatCurrency(g.targetAmount)}${g.targetDate ? ` · até ${formatDateBR(g.targetDate)}` : ""}</p>
        <div class="progress-bar" style="height:12px"><div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div></div>
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
    if (confirm("Excluir esta meta?")) { Store.removeGoal(id); renderGoals(); }
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
function renderBudget() {
  const { settings, budgets, transactions } = Store.get();
  const month = $("#budget-filter-month").value || todayMonthKey();
  $("#budget-filter-month").value = month;

  const spentByCategory = {};
  transactions.filter((t) => t.type === "expense" && monthKey(t.date) === month)
    .forEach((t) => { spentByCategory[t.category] = (spentByCategory[t.category] || 0) + t.amount; });

  const tbody = $("#budget-table-body");
  tbody.innerHTML = settings.expenseCategories.map((cat) => {
    const budget = budgets.find((b) => b.category === cat);
    const limit = budget ? budget.monthlyLimit : 0;
    const spent = spentByCategory[cat] || 0;
    const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
    const barClass = limit === 0 ? "" : spent > limit ? "over" : pct > 80 ? "warning" : "";
    return `
      <tr data-category="${escapeHtml(cat)}">
        <td>${escapeHtml(cat)}</td>
        <td class="right"><input type="number" min="0" step="0.01" class="budget-limit-input" value="${limit || ""}" placeholder="0,00" style="width:110px"></td>
        <td class="right">${formatCurrency(spent)}</td>
        <td><div class="progress-bar"><div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div></div></td>
        <td><button class="btn secondary small" data-action="save-budget">Salvar</button></td>
      </tr>
    `;
  }).join("");
}

$("#budget-filter-month").addEventListener("change", renderBudget);

$("#budget-table-body").addEventListener("click", (e) => {
  if (e.target.dataset.action !== "save-budget") return;
  const row = e.target.closest("tr");
  const category = row.dataset.category;
  const value = parseFloat(row.querySelector(".budget-limit-input").value) || 0;
  Store.setBudget(category, value);
  renderBudget();
  renderOpportunitiesView();
  toast("Orçamento atualizado.");
});

function renderBills() {
  const { bills } = Store.get();
  const tbody = $("#bills-table-body");
  tbody.innerHTML = bills.map((b) => `
    <tr data-id="${b.id}">
      <td>${escapeHtml(b.name)}</td>
      <td>${escapeHtml(b.category)}</td>
      <td class="right">${formatCurrency(b.amount)}</td>
      <td>Dia ${b.dueDay}</td>
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
    if (confirm("Excluir esta conta fixa?")) { Store.removeBill(id); renderBills(); renderOpportunitiesView(); }
  }
});

function openBillModal(id) {
  populateCategorySelects();
  const modal = $("#modal-bill");
  if (id) {
    const b = Store.get().bills.find((x) => x.id === id);
    $("#modal-bill-title").textContent = "Editar conta fixa";
    $("#bill-id").value = b.id;
    $("#bill-name").value = b.name;
    $("#bill-category").value = b.category;
    $("#bill-amount").value = b.amount;
    $("#bill-due-day").value = b.dueDay;
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
function renderOpportunityCards(list) {
  if (list.length === 0) return `<p class="empty-opportunities">Nenhum alerta no momento.</p>`;
  return list.map((o) => `
    <div class="opportunity level-${o.level}">
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
  renderRules();
}

function renderRules() {
  const { categoryRules } = Store.get();
  $("#rules-table-body").innerHTML = categoryRules.map((r) => `
    <tr data-id="${r.id}">
      <td>${escapeHtml(r.keyword)}</td>
      <td>${r.type === "income" ? "Receita" : "Despesa"}</td>
      <td>${escapeHtml(r.category)}</td>
      <td><button class="btn danger small" data-action="del-rule">Excluir</button></td>
    </tr>
  `).join("");
}

$("#rules-table-body").addEventListener("click", (e) => {
  if (e.target.dataset.action !== "del-rule") return;
  const id = e.target.closest("tr").dataset.id;
  Store.removeCategoryRule(id);
  renderRules();
});

$("#btn-add-rule").addEventListener("click", () => {
  const keyword = $("#rule-keyword").value.trim();
  if (!keyword) { toast("Informe uma palavra-chave."); return; }
  Store.addCategoryRule({ keyword, type: $("#rule-type").value, category: $("#rule-category").value });
  $("#rule-keyword").value = "";
  renderRules();
  toast("Regra adicionada.");
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
  const list = $("#cfg-expense-categories").value.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) { toast("A lista de categorias não pode ficar vazia."); return; }
  Store.updateSettings({ expenseCategories: list });
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

function formatDateBR(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function renderAll() {
  populateCategorySelects();
  renderDashboard();
  renderTransactions();
  renderInvestments();
  renderGoals();
  renderBudget();
  renderBills();
  renderOpportunitiesView();
  renderSettings();
}

$("#tx-filter-month").value = todayMonthKey();
$("#budget-filter-month").value = todayMonthKey();

Store.onChange(() => {}); // reservado para reatividade futura entre views

renderAll();
