// Visualizador da pasta de extratos. Três telas: fluxo mensal, investimentos e a base
// de dados bruta. Não existe formulário: tudo que aparece veio de um arquivo lido da
// pasta escolhida pelo usuário (js/auto-import.js).
import { Store } from "./storage.js";
import {
  formatCurrency, formatPercent, monthKey, todayMonthKey, monthLabel, shortMonthLabel,
  lastNMonths, formatDateBR, findDuplicateGroups, debounce, CLASS_LABELS,
  isCashFlow, INVESTMENT_CATEGORY, CARD_INVOICE_CATEGORY,
} from "./utils.js";
import { isProceeds } from "./investment-flow.js";
import { cashflowChart, categoriesChart, allocationChart, proceedsChart, resizeCharts } from "./charts.js";
import * as AutoImport from "./auto-import.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

let toastTimer;
function toast(msg) {
  $("#toast-msg").textContent = msg;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4000);
}

// ============================================================
// tema
// ============================================================
function applyTheme() {
  const { theme } = Store.get().settings;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

$("#btn-theme").addEventListener("click", () => {
  const current = Store.get().settings.theme;
  const showingDark = current === "dark" || (current === "system" && prefersDark());
  Store.updateSettings({ theme: showingDark ? "light" : "dark" });
  applyTheme();
  renderAll(); // recria os gráficos para pegarem as cores do tema novo
});

// ============================================================
// navegação
// ============================================================
function switchView(view) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  window.scrollTo(0, 0);
  resizeCharts();
}

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (btn) switchView(btn.dataset.view);
});

// ============================================================
// 1. RECEITA E GASTOS
// ============================================================
function monthsInRange() {
  const n = Number($("#fluxo-range").value) || 12;
  return lastNMonths(n, todayMonthKey());
}

function cashFlowTransactions() {
  return Store.get().transactions.filter(isCashFlow);
}

function renderFluxo() {
  const months = monthsInRange();
  const txs = cashFlowTransactions();
  const inRange = txs.filter((t) => months.includes(monthKey(t.date)));

  const income = months.map((m) => sumBy(inRange, (t) => t.type === "income" && monthKey(t.date) === m));
  const expense = months.map((m) => sumBy(inRange, (t) => t.type === "expense" && monthKey(t.date) === m));

  const activeMonths = months.filter((m, i) => income[i] > 0 || expense[i] > 0).length || 1;
  const avgIncome = income.reduce((a, b) => a + b, 0) / activeMonths;
  const avgExpense = expense.reduce((a, b) => a + b, 0) / activeMonths;
  const avgBalance = avgIncome - avgExpense;
  const savingsRate = avgIncome > 0 ? (avgBalance / avgIncome) * 100 : 0;

  $("#fluxo-subtitle").textContent = inRange.length === 0
    ? "Nenhum lançamento no período."
    : `${inRange.length} lançamentos · ${activeMonths} ${activeMonths === 1 ? "mês" : "meses"} com movimento`;

  $("#fluxo-stats").innerHTML = `
    ${statCard("Receita média/mês", formatCurrency(avgIncome), "positive", "média dos meses com movimento")}
    ${statCard("Despesa média/mês", formatCurrency(avgExpense), "negative", "sem compra/resgate de ativos")}
    ${statCard("Saldo médio/mês", formatCurrency(avgBalance), avgBalance >= 0 ? "positive" : "negative", "receita menos despesa")}
    ${statCard("Taxa de poupança", formatPercent(savingsRate), savingsRate >= 0 ? "positive" : "negative", "do que entra, quanto sobra")}
  `;

  cashflowChart("chart-fluxo", months.map(shortMonthLabel), income, expense);

  // gastos por categoria
  const byCategory = {};
  inRange.filter((t) => t.type === "expense").forEach((t) => {
    byCategory[t.category || "Outros"] = (byCategory[t.category || "Outros"] || 0) + t.amount;
  });
  const cats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 8);
  categoriesChart("chart-categorias", cats.map((c) => c[0]), cats.map((c) => c[1]));

  renderTopExpenses(inRange);
  renderFluxoTable(months, income, expense);
}

// Agrupa gastos por descrição normalizada (sem a data/ID que muda a cada mês) para
// mostrar para onde o dinheiro realmente foi no período.
function normalizeDescription(desc) {
  return (desc || "")
    .toUpperCase()
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, "")
    .replace(/\b\d{4,}\b/g, "")
    .replace(/[-–—]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function renderTopExpenses(transactions) {
  const groups = new Map();
  transactions.filter((t) => t.type === "expense").forEach((t) => {
    const key = normalizeDescription(t.description) || t.description;
    if (!groups.has(key)) groups.set(key, { key, total: 0, count: 0, sample: t.description });
    const g = groups.get(key);
    g.total += t.amount;
    g.count += 1;
  });

  const ranked = [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  const max = ranked.length > 0 ? ranked[0].total : 0;

  $("#fluxo-top-expenses").innerHTML = ranked.length === 0
    ? `<p class="muted small">Nenhuma despesa no período.</p>`
    : ranked.map((g) => `
        <div class="rank-row">
          <div>
            <div class="name">${escapeHtml(g.key)}</div>
            <div class="meta">${g.count}${g.count === 1 ? " lançamento" : " lançamentos"}</div>
          </div>
          <div class="value">${formatCurrency(g.total)}</div>
          <div class="rank-bar"><i style="width:${max > 0 ? (g.total / max) * 100 : 0}%"></i></div>
        </div>
      `).join("");
}

function renderFluxoTable(months, income, expense) {
  let accumulated = 0;
  const rows = months.map((m, i) => {
    const balance = income[i] - expense[i];
    accumulated += balance;
    return `
      <tr>
        <td>${monthLabel(m)}</td>
        <td class="right amount-income">${formatCurrency(income[i])}</td>
        <td class="right amount-expense">${formatCurrency(expense[i])}</td>
        <td class="right ${balance >= 0 ? "amount-income" : "amount-expense"}">${formatCurrency(balance)}</td>
        <td class="right ${accumulated >= 0 ? "amount-income" : "amount-expense"}">${formatCurrency(accumulated)}</td>
      </tr>`;
  });
  $("#fluxo-table").innerHTML = rows.reverse().join("");
}

$("#fluxo-range").addEventListener("change", renderFluxo);

// ============================================================
// 2. INVESTIMENTOS
// ============================================================
function renderInvestimentos() {
  const { investments, transactions } = Store.get();
  const total = investments.reduce((s, i) => s + (i.currentValue || 0), 0);

  const proceeds = transactions.filter(isProceeds);
  const proceeds12 = proceeds.filter((t) => lastNMonths(12, todayMonthKey()).includes(monthKey(t.date)));
  const proceedsTotal = proceeds12.reduce((s, t) => s + t.amount, 0);

  const byClass = {};
  investments.forEach((i) => {
    const label = CLASS_LABELS[i.class] || i.class || "Outros";
    byClass[label] = (byClass[label] || 0) + (i.currentValue || 0);
  });
  const classEntries = Object.entries(byClass).sort((a, b) => b[1] - a[1]);
  const biggestClass = classEntries[0];

  $("#inv-subtitle").textContent = investments.length === 0
    ? "Nenhuma posição — importe um backup JSON com investimentos para a pasta."
    : `${investments.length} ${investments.length === 1 ? "posição" : "posições"} · ${classEntries.length} ${classEntries.length === 1 ? "classe" : "classes"}`;

  // O PDF de posição consolidada traz o rendimento em R$ no ano corrente por tipo de
  // investimento. É mostrado como veio: derivar um percentual dividindo pelo valor
  // atual daria um número errado sempre que houve aporte durante o ano.
  const withYearReturn = investments.filter((i) => typeof i.yearReturn === "number");
  const yearReturnTotal = withYearReturn.reduce((s, i) => s + i.yearReturn, 0);

  $("#inv-stats").innerHTML = `
    ${statCard("Total investido", formatCurrency(total), "", `${investments.length} posições`)}
    ${withYearReturn.length > 0
      ? statCard("Rendimento no ano", formatCurrency(yearReturnTotal), yearReturnTotal >= 0 ? "positive" : "negative", "como informado no PDF da carteira")
      : ""}
    ${statCard("Proventos (12 meses)", formatCurrency(proceedsTotal), "positive", `${proceeds12.length} créditos no extrato`)}
    ${statCard("Maior classe", biggestClass ? biggestClass[0] : "—", "",
      biggestClass && total > 0 ? `${formatPercent((biggestClass[1] / total) * 100)} da carteira` : "—")}
    ${statCard("Maior posição", investments.length ? topInvestment(investments).name : "—", "",
      investments.length ? formatCurrency(topInvestment(investments).currentValue) : "—")}
  `;

  $("#aloc-empty").hidden = classEntries.length > 0;
  $("#aloc-box").hidden = classEntries.length === 0;
  if (classEntries.length > 0) {
    allocationChart("chart-alocacao", classEntries.map((c) => c[0]), classEntries.map((c) => c[1]));
  }

  const months = lastNMonths(12, todayMonthKey());
  proceedsChart(
    "chart-proventos",
    months.map(shortMonthLabel),
    months.map((m) => sumBy(proceeds, (t) => monthKey(t.date) === m)),
  );

  $("#inv-table").innerHTML = investments.length === 0
    ? `<tr><td colspan="6" class="empty-row">Nenhuma posição cadastrada.</td></tr>`
    : investments.slice().sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0)).map((inv) => {
        const pct = total > 0 ? ((inv.currentValue || 0) / total) * 100 : 0;
        return `
          <tr>
            <td class="desc">${escapeHtml(inv.name)}</td>
            <td>${escapeHtml(CLASS_LABELS[inv.class] || inv.class || "—")}</td>
            <td>${escapeHtml(liquidityLabel(inv.liquidity))}</td>
            <td class="right ${typeof inv.yearReturn === "number" ? (inv.yearReturn >= 0 ? "amount-income" : "amount-expense") : ""}">${
              typeof inv.yearReturn === "number" ? formatCurrency(inv.yearReturn) : "—"
            }</td>
            <td class="right">${formatCurrency(inv.currentValue)}</td>
            <td>
              <div class="pct-cell">
                <div class="pct-track"><i style="width:${pct}%"></i></div>
                <span class="pct-num">${formatPercent(pct)}</span>
              </div>
            </td>
          </tr>`;
      }).join("");

  renderPortfolioHistory();
}

// Série de posições consolidadas lidas da pasta. Uma data só já vale: mostra de quando
// é a carteira que está na tela. Com duas ou mais, aparece a variação do patrimônio —
// variação, não rentabilidade: aporte e resgate entram nela (ver investment-flow.js).
function renderPortfolioHistory() {
  const snapshots = Store.portfolioHistory();
  $("#hist-panel").hidden = snapshots.length === 0;
  if (snapshots.length === 0) return;

  const rows = snapshots.map((snap, i) => {
    const previous = i > 0 ? snapshots[i - 1] : null;
    const delta = previous ? snap.total - previous.total : null;
    const deltaPct = previous && previous.total > 0 ? (delta / previous.total) * 100 : null;
    return `
      <tr>
        <td>${formatDateBR(snap.date)}</td>
        <td class="right">${formatCurrency(snap.total)}</td>
        <td class="right ${delta === null ? "" : delta >= 0 ? "amount-income" : "amount-expense"}">${
          delta === null
            ? "—"
            : `${delta >= 0 ? "+" : ""}${formatCurrency(delta)}${deltaPct === null ? "" : ` (${deltaPct >= 0 ? "+" : ""}${formatPercent(deltaPct)})`}`
        }</td>
        <td class="desc">${escapeHtml(snap.source || "—")}</td>
      </tr>`;
  });
  $("#hist-table").innerHTML = rows.reverse().join("");
}

function topInvestment(investments) {
  return investments.slice().sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0))[0];
}

function liquidityLabel(liq) {
  return { alta: "Alta", media: "Média", baixa: "Baixa" }[liq] || "—";
}

// ============================================================
// 3. BASE DE DADOS
// ============================================================
const PAGE_SIZE = 50;
let txPage = 0;

const STATUS_CHIP = {
  ok: { cls: "ok", label: "Importado" },
  partial: { cls: "warn", label: "Parcial" },
  unsupported: { cls: "", label: "Não suportado" },
  error: { cls: "error", label: "Erro" },
};

function renderDados() {
  const { transactions, investments, importedFiles } = Store.get();
  const cardItems = transactions.filter((t) => t.category === CARD_INVOICE_CATEGORY).length;
  $("#dados-subtitle").textContent = importedFiles.length === 0
    ? "Nada lido ainda."
    : `${importedFiles.length} arquivo(s) · ${transactions.length} lançamentos · ${investments.length} investimento(s)` +
      (cardItems > 0 ? ` · ${cardItems} itens de fatura (fora das somas, para não contar em dobro)` : "");

  renderDuplicates();
  renderFilesTable();
  renderTxFilters();
  renderTxTable();
}

function renderDuplicates() {
  const groups = findDuplicateGroups(Store.get().transactions)
    .sort((a, b) => b[0].date.localeCompare(a[0].date));

  $("#dup-panel").hidden = groups.length === 0;
  if (groups.length === 0) return;

  $("#dup-table").innerHTML = groups.map((g, i) => {
    const t = g[0];
    return `
      <tr>
        <td>${formatDateBR(t.date)}</td>
        <td class="desc">${escapeHtml(t.description)}</td>
        <td class="right amount-${t.type}">${formatCurrency(t.amount)}</td>
        <td class="right">${g.length}</td>
        <td class="right"><button class="btn danger small" data-dedupe="${i}" type="button">Manter 1</button></td>
      </tr>`;
  }).join("");
}

$("#dup-table").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-dedupe]");
  if (!btn) return;
  const groups = findDuplicateGroups(Store.get().transactions)
    .sort((a, b) => b[0].date.localeCompare(a[0].date));
  const group = groups[Number(btn.dataset.dedupe)];
  if (!group) return;

  // mantém a cópia mais completa (com conta vinculada e categoria específica)
  const keep = group.slice().sort((a, b) => {
    if (Boolean(a.accountId) !== Boolean(b.accountId)) return a.accountId ? -1 : 1;
    if ((a.category === "Outros") !== (b.category === "Outros")) return a.category === "Outros" ? 1 : -1;
    return 0;
  })[0];
  const remove = group.filter((t) => t.id !== keep.id).map((t) => t.id);

  Store.removeTransactions(remove);
  renderAll();
  toast(`${remove.length} duplicata(s) removida(s).`);
});

function renderFilesTable() {
  const files = Store.get().importedFiles.slice()
    .sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || ""));

  $("#files-table").innerHTML = files.length === 0
    ? `<tr><td colspan="8" class="empty-row">Nenhum arquivo lido ainda.</td></tr>`
    : files.map((f) => {
        const chip = STATUS_CHIP[f.status] || { cls: "", label: f.status || "—" };
        const warnings = f.warnings || [];
        return `
          <tr>
            <td class="desc">${escapeHtml(f.name || "—")}</td>
            <td>${escapeHtml((f.type || "?").toUpperCase())}</td>
            <td><span class="chip ${chip.cls}">${chip.label}</span></td>
            <td>${f.importedAt ? new Date(f.importedAt).toLocaleString("pt-BR") : "—"}</td>
            <td class="right">${f.recordsFound ?? "—"}</td>
            <td class="right">${f.recordsImported ?? "—"}</td>
            <td class="right">${f.duplicatesSkipped ?? 0}</td>
            <td>${warnings.length === 0 ? "—" : `
              <details><summary>${warnings.length} linha(s)</summary>
                <ul>${warnings.slice(0, 25).map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
              </details>`}</td>
          </tr>`;
      }).join("");
}

function renderTxFilters() {
  const select = $("#tx-month-filter");
  const current = select.value;
  const months = Array.from(new Set(Store.get().transactions.map((t) => monthKey(t.date))))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
  select.innerHTML = `<option value="">Todos os meses</option>` +
    months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("");
  if (months.includes(current)) select.value = current;
}

function filteredTransactions() {
  const term = ($("#tx-search").value || "").trim().toLowerCase();
  const type = $("#tx-type-filter").value;
  const month = $("#tx-month-filter").value;

  return Store.get().transactions
    .filter((t) => (!term || (t.description || "").toLowerCase().includes(term)))
    .filter((t) => (!type || t.type === type))
    .filter((t) => (!month || monthKey(t.date) === month))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderTxTable() {
  const all = filteredTransactions();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  txPage = Math.min(txPage, pages - 1);
  const slice = all.slice(txPage * PAGE_SIZE, (txPage + 1) * PAGE_SIZE);

  const total = Store.get().transactions.length;
  $("#tx-count").textContent = all.length === total
    ? `${total} lançamentos no total.`
    : `${all.length} de ${total} lançamentos.`;

  $("#tx-table").innerHTML = slice.length === 0
    ? `<tr><td colspan="6" class="empty-row">Nenhum lançamento.</td></tr>`
    : slice.map((t) => `
        <tr>
          <td>${formatDateBR(t.date)}</td>
          <td class="desc">${escapeHtml(t.description)}</td>
          <td>${t.category === INVESTMENT_CATEGORY || t.category === CARD_INVOICE_CATEGORY
            ? `<span class="chip accent">${escapeHtml(t.category)}</span>`
            : escapeHtml(t.category || "—")}</td>
          <td>${escapeHtml(Store.accountName(t.accountId) || t.account || "—")}</td>
          <td class="muted small">${escapeHtml(t.source || "—")}</td>
          <td class="right amount-${t.type}">${t.type === "expense" ? "−" : "+"} ${formatCurrency(t.amount)}</td>
        </tr>`).join("");

  $("#tx-page").textContent = `Página ${txPage + 1} de ${pages}`;
  $("#tx-prev").disabled = txPage === 0;
  $("#tx-next").disabled = txPage >= pages - 1;
}

$("#tx-search").addEventListener("input", debounce(() => { txPage = 0; renderTxTable(); }, 200));
$("#tx-type-filter").addEventListener("change", () => { txPage = 0; renderTxTable(); });
$("#tx-month-filter").addEventListener("change", () => { txPage = 0; renderTxTable(); });
$("#tx-prev").addEventListener("click", () => { if (txPage > 0) { txPage--; renderTxTable(); } });
$("#tx-next").addEventListener("click", () => { txPage++; renderTxTable(); });

$("#btn-reset").addEventListener("click", () => {
  if (!confirm("Isso apaga tudo que já foi lido (transações, investimentos e o histórico de arquivos). Os arquivos da pasta continuam lá e serão lidos de novo. Continuar?")) return;
  Store.resetAll();
  renderAll();
  toast("Dados apagados. Clique em Atualizar para ler a pasta de novo.");
});

// ============================================================
// pasta automática
// ============================================================
let dirHandle = null;
let needsPermission = false;

function renderFolderState() {
  const supported = AutoImport.isSupported();
  const hasData = Store.get().transactions.length > 0 || Store.get().investments.length > 0;

  $("#folder-pill").hidden = !dirHandle;
  $("#btn-refresh").hidden = !dirHandle;
  $("#btn-folder").textContent = dirHandle ? "Trocar pasta" : "Escolher pasta";

  if (dirHandle) {
    $("#folder-name").textContent = dirHandle.name;
    $("#folder-pill").classList.toggle("stale", needsPermission);
    $("#folder-pill").title = needsPermission
      ? "O navegador pediu a permissão de novo — clique em Atualizar"
      : `Lendo de: ${dirHandle.name}`;
  }

  const showEmpty = !hasData;
  $("#empty-screen").hidden = !showEmpty;
  document.body.classList.toggle("no-data", showEmpty);
  if (showEmpty) {
    $("#empty-support").textContent = supported
      ? ""
      : "Seu navegador não suporta escolher uma pasta — use Chrome, Edge ou Brave.";
    $("#btn-folder-empty").disabled = !supported;
    $("#empty-text").textContent = needsPermission
      ? "O navegador esqueceu a permissão da pasta. Escolha de novo para continuar."
      : "O app lê sozinho os arquivos dessa pasta toda vez que abrir — CSV, OFX, Excel, PDF do banco e backup JSON. Nada sai do seu navegador.";
  }
}

function scanSummaryToast(summary) {
  const parts = [];
  if (summary.transactionsImported > 0) parts.push(`${summary.transactionsImported} lançamento(s)`);
  if (summary.investmentsImported > 0) parts.push(`${summary.investmentsImported} investimento(s)`);
  if (summary.investmentsUpdated > 0) parts.push(`${summary.investmentsUpdated} posição(ões) atualizada(s)`);
  if (parts.length > 0) {
    toast(`Pasta lida: ${parts.join(", ")}.`);
    return;
  }
  if (summary.errors.length > 0) { toast(`${summary.errors.length} arquivo(s) com erro — veja a aba Base de dados.`); return; }
  if (summary.filesScanned > 0) toast("Pasta verificada — nada novo.");
}

async function scanFolder(handle, { interactive }) {
  const granted = await AutoImport.verifyPermission(handle, interactive);
  needsPermission = !granted;
  if (!granted) {
    renderFolderState();
    if (interactive) toast("Permissão de leitura negada para essa pasta.");
    return;
  }
  const summary = await AutoImport.scanAndImport(handle);
  renderAll();
  scanSummaryToast(summary);
}

async function chooseFolder() {
  if (!AutoImport.isSupported()) {
    toast("Seu navegador não suporta escolher uma pasta — use Chrome, Edge ou Brave.");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    await AutoImport.saveDirectoryHandle(handle);
    dirHandle = handle;
    await scanFolder(handle, { interactive: true });
  } catch (err) {
    if (err.name !== "AbortError") toast("Não foi possível acessar a pasta.");
  }
}

$("#btn-folder").addEventListener("click", chooseFolder);
$("#btn-folder-empty").addEventListener("click", chooseFolder);
$("#btn-refresh").addEventListener("click", async () => {
  if (!dirHandle) return;
  await scanFolder(dirHandle, { interactive: true });
});

// Ao abrir: recupera a pasta salva e lê o que houver de novo, sem pedir nada.
async function initFolder() {
  if (!AutoImport.isSupported()) { renderFolderState(); return; }
  const handle = await AutoImport.loadDirectoryHandle().catch(() => null);
  if (!handle) { renderFolderState(); return; }
  dirHandle = handle;
  renderFolderState();
  await scanFolder(handle, { interactive: false });
}

// ============================================================
// helpers de render
// ============================================================
function sumBy(list, predicate) {
  return list.reduce((sum, item) => (predicate(item) ? sum + item.amount : sum), 0);
}

function statCard(label, value, tone, note) {
  return `
    <div class="stat">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value ${tone}">${escapeHtml(value)}</span>
      <span class="stat-note">${escapeHtml(note)}</span>
    </div>`;
}

// A visibilidade vem primeiro: o Chart.js não consegue dimensionar um canvas dentro
// de um container display:none, então as telas precisam estar visíveis antes de
// desenhar os gráficos.
function renderAll() {
  renderFolderState();
  renderFluxo();
  renderInvestimentos();
  renderDados();
}

applyTheme();
renderAll();
initFolder();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
