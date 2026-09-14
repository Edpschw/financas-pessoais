// Rótulo padrão usado pelos parsers quando o arquivo não traz (ou não mapeia) uma
// coluna de conta — "Importado (CSV)", "Importado (PDF)", etc. Serve para decidir se
// vale resolver/criar uma conta pelo nome ou deixar a transação sem conta vinculada.
export function isImportedPlaceholderAccount(name) {
  return /^Importado \(.+\)$/.test((name || "").trim());
}

// Categorias que não são gasto nem renda de verdade e por isso ficam fora das somas
// de fluxo (aba "Receita e gastos"):
//  - Investimentos: comprar/resgatar um ativo é dinheiro mudando de lugar.
//  - Fatura cartão: os itens da fatura são o detalhe de uma despesa que o extrato já
//    contabiliza como um pagamento único ("ITAU BLACK ..."). Contar os dois somaria
//    duas vezes o mesmo gasto — o detalhe fica visível na aba "Base de dados".
export const INVESTMENT_CATEGORY = "Investimentos";
export const CARD_INVOICE_CATEGORY = "Fatura cartão";
const NON_CASHFLOW_CATEGORIES = new Set([INVESTMENT_CATEGORY, CARD_INVOICE_CATEGORY]);

export function isCashFlow(transaction) {
  return !NON_CASHFLOW_CATEGORIES.has(transaction.category);
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
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

// Rótulo curto para eixos de gráfico: "jan/26".
export function shortMonthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const mon = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return `${mon}/${String(y).slice(-2)}`;
}

export function lastNMonths(n, endMonth = todayMonthKey()) {
  const months = [];
  for (let i = n - 1; i >= 0; i--) months.push(addMonths(endMonth, -i));
  return months;
}

export const CLASS_LABELS = {
  renda_fixa: "Renda fixa",
  acoes: "Ações",
  fundos: "Fundos",
  fiis: "Fundos imobiliários",
  internacional: "Internacional",
  cripto: "Cripto",
  outros: "Outros",
};

export function formatDateBR(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Duas transações são consideradas duplicadas se caírem na mesma data, mesmo valor,
// mesmo tipo e descrição normalizada igual — heurística usada na importação para não
// trazer o mesmo extrato duas vezes.
export function isDuplicateTransaction(candidate, existing) {
  const normDesc = (s) => (s || "").trim().toLowerCase();
  return existing.some((t) =>
    t.date === candidate.date &&
    Math.abs(t.amount - candidate.amount) < 0.005 &&
    t.type === candidate.type &&
    normDesc(t.description) === normDesc(candidate.description)
  );
}

// Agrupa transações já salvas que são mutuamente duplicatas pelo mesmo critério acima
// — para auditar depois de ler o mesmo período de mais de um arquivo (ex: o CSV e o
// PDF do mesmo extrato).
export function findDuplicateGroups(transactions) {
  const groups = new Map();
  transactions.forEach((t) => {
    const key = [t.date, Math.round(t.amount * 100), t.type, (t.description || "").trim().toLowerCase()].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
