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
