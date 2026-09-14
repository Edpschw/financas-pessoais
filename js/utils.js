// Rótulo padrão usado por rowsToTransactions/parseOFX quando o arquivo não traz
// (ou não mapeia) uma coluna de conta. Serve para decidir se vale a pena tentar
// resolver/criar uma conta pelo nome, ou deixar a transação sem conta vinculada.
export function isImportedPlaceholderAccount(name) {
  return name === "Importado (CSV)" || name === "Importado (OFX)";
}

export function formatCurrency(value) {
  return (value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatPercent(value, digits = 1) {
  return `${(value || 0).toFixed(digits)}%`;
}

export function monthKey(dateStr) {
  return (dateStr || "").slice(0, 7); // YYYY-MM
}

export function todayMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export function addMonths(monthStr, delta) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function lastNMonths(n, endMonth = todayMonthKey()) {
  const months = [];
  for (let i = n - 1; i >= 0; i--) months.push(addMonths(endMonth, -i));
  return months;
}

export const CLASS_LABELS = {
  renda_fixa: "Renda Fixa",
  acoes: "Ações",
  fiis: "Fundos Imobiliários",
  internacional: "Internacional",
  cripto: "Cripto",
  outros: "Outros",
};

export const RISK_PROFILES = {
  conservador: { renda_fixa: 80, fiis: 10, acoes: 5, internacional: 5, cripto: 0, outros: 0 },
  moderado: { renda_fixa: 50, acoes: 25, fiis: 15, internacional: 10, cripto: 0, outros: 0 },
  arrojado: { renda_fixa: 25, acoes: 40, fiis: 15, internacional: 20, cripto: 0, outros: 0 },
};

export function uniqueSorted(list) {
  return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function formatDateBR(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Uma transação normalmente tem uma única categoria; se foi dividida (splits),
// cada pedaço deve contar para sua própria categoria nas somas de orçamento/gráficos.
export function categoryBreakdown(tx) {
  if (Array.isArray(tx.splits) && tx.splits.length > 0) return tx.splits;
  return [{ category: tx.category, amount: tx.amount }];
}

// Lista de meses (YYYY-MM) estritamente entre `fromMonth` (exclusive) e `toMonth` (inclusive).
// Usada para gerar lançamentos recorrentes que ficaram pendentes desde a última visita.
export function monthsBetweenExclusive(fromMonth, toMonth) {
  const months = [];
  let cursor = fromMonth ? addMonths(fromMonth, 1) : toMonth;
  let guard = 0;
  while (cursor <= toMonth && guard < 600) {
    months.push(cursor);
    if (cursor === toMonth) break;
    cursor = addMonths(cursor, 1);
    guard++;
  }
  return months;
}

// Duas transações são consideradas duplicadas se caírem na mesma data, mesmo valor
// (em módulo) e descrição normalizada igual — heurística usada ao importar CSV/OFX
// para evitar reimportar o mesmo extrato duas vezes.
export function isDuplicateTransaction(candidate, existing) {
  const normDesc = (s) => (s || "").trim().toLowerCase();
  return existing.some((t) =>
    t.date === candidate.date &&
    Math.abs(t.amount - candidate.amount) < 0.005 &&
    t.type === candidate.type &&
    normDesc(t.description) === normDesc(candidate.description)
  );
}

// Agrupa transações já existentes no store que são mutuamente "duplicatas" pelo mesmo
// critério de isDuplicateTransaction (data + valor + tipo + descrição) — útil pra
// auditar depois de importar o mesmo período de mais de uma fonte (ex: CSV e PDF do
// mesmo extrato, ou reimportar sem perceber). Transferências ficam de fora: têm campos
// próprios (fromAccountId/toAccountId) e duplicidade nelas é rara/diferente.
export function findDuplicateGroups(transactions) {
  const groups = new Map();
  transactions.forEach((t) => {
    if (t.type !== "expense" && t.type !== "income") return;
    const key = [t.date, Math.round(t.amount * 100), t.type, (t.description || "").trim().toLowerCase()].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}

// Hash simples (SHA-256, hex) usado só para um bloqueio local por PIN — não é uma
// defesa criptográfica real (os dados continuam em texto plano no localStorage),
// apenas evita que o PIN fique salvo em claro e dificulta uma espiada casual.
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const DAY_MS = 1000 * 60 * 60 * 24;

// XIRR: taxa anualizada que zera o valor presente de um fluxo de caixa com datas
// irregulares (aportes em datas diferentes + valor atual como "resgate" hoje).
// Mesma técnica usada por rastreadores de carteira como Portfolio Performance/Paisa.
export function xirr(cashflows) {
  if (!cashflows || cashflows.length < 2) return null;
  const t0 = new Date(cashflows[0].date).getTime();
  const years = cashflows.map((c) => (new Date(c.date).getTime() - t0) / DAY_MS / 365);

  const npv = (rate) => cashflows.reduce((sum, c, i) => sum + c.amount / Math.pow(1 + rate, years[i]), 0);
  const dnpv = (rate) => cashflows.reduce((sum, c, i) => sum - (years[i] * c.amount) / Math.pow(1 + rate, years[i] + 1), 0);

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-10) break;
    const next = rate - f / df;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-7) { rate = next; break; }
    rate = Math.max(next, -0.999);
  }
  return Number.isFinite(rate) ? rate * 100 : null;
}
