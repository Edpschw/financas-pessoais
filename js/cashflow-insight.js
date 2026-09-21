// Avaliação crítica de receita/gastos: não só os números, um julgamento sobre eles.
// Puro (sem DOM) — recebe as transações já filtradas por isCashFlow e o range de
// meses, devolve uma lista de cartões { level, title, desc }, mesmo formato usado
// pela atratividade de investimento, para reaproveitar um único componente de render.
import { monthKey, normalizeDescription } from "./utils.js";

function sumBy(list, pick) {
  return list.reduce((s, t) => s + (pick(t) ? t.amount : 0), 0);
}

// Meses no vermelho: quantos meses do período têm despesa > receita, e quais.
function redMonthsInsight(transactions, months) {
  const redMonths = months.filter((m) => {
    const income = sumBy(transactions, (t) => t.type === "income" && monthKey(t.date) === m);
    const expense = sumBy(transactions, (t) => t.type === "expense" && monthKey(t.date) === m);
    return income > 0 || expense > 0 ? expense > income : false;
  });
  if (redMonths.length === 0) {
    return { level: "ok", title: "Nenhum mês no vermelho", desc: "Em todos os meses com movimento, a receita cobriu a despesa." };
  }
  return {
    level: redMonths.length > months.length / 2 ? "error" : "warn",
    title: `${redMonths.length} ${redMonths.length === 1 ? "mês" : "meses"} no vermelho`,
    desc: `Despesa maior que receita em: ${redMonths.join(", ")}.`,
  };
}

// Concentração de despesa recorrente: reaproveita o mesmo agrupamento por descrição
// normalizada usado nos "maiores gastos" — sinaliza quando um único grupo passa de
// ~15-20% da receita média, porque um valor tão grande e repetido merece atenção
// mesmo sendo "só" uma despesa a mais na lista.
const RECURRING_CONCENTRATION_THRESHOLD_PCT = 15;

function recurringConcentrationInsight(transactions, months) {
  const expenses = transactions.filter((t) => t.type === "expense");
  const income = transactions.filter((t) => t.type === "income");
  const activeMonths = months.filter((m) => (
    income.some((t) => monthKey(t.date) === m) || expenses.some((t) => monthKey(t.date) === m)
  )).length || 1;
  const avgIncome = sumBy(income, () => true) / activeMonths;
  if (avgIncome <= 0) return null;

  const groups = new Map();
  expenses.forEach((t) => {
    const key = normalizeDescription(t.description) || t.description;
    groups.set(key, (groups.get(key) || 0) + t.amount);
  });
  let top = null;
  groups.forEach((total, key) => { if (!top || total > top.total) top = { key, total }; });
  if (!top) return null;

  const sharePct = (top.total / activeMonths / avgIncome) * 100;
  if (sharePct <= RECURRING_CONCENTRATION_THRESHOLD_PCT) return null;

  return {
    level: "warn",
    title: "Um gasto recorrente domina o orçamento",
    desc: `"${top.key}" soma ${sharePct.toFixed(0)}% da receita média mensal no período.`,
  };
}

// "Outros" dominante: se a categorização não diz muito sobre o gasto, mais honesto
// avisar isso do que fingir que a análise por categoria é conclusiva.
const OTHERS_DOMINANCE_THRESHOLD_PCT = 40;

function othersDominanceInsight(transactions) {
  const expenses = transactions.filter((t) => t.type === "expense");
  const total = sumBy(expenses, () => true);
  if (total <= 0) return null;
  const others = sumBy(expenses, (t) => (t.category || "Outros") === "Outros");
  const sharePct = (others / total) * 100;
  if (sharePct <= OTHERS_DOMINANCE_THRESHOLD_PCT) return null;
  return {
    level: "warn",
    title: `"Outros" concentra ${sharePct.toFixed(0)}% dos gastos`,
    desc: "A categorização está fraca demais para dizer muito sobre para onde o dinheiro foi — a análise por categoria abaixo é só um retrato parcial.",
  };
}

// Tendência de poupança: primeira metade do período contra a segunda.
function savingsTrendInsight(transactions, months) {
  if (months.length < 4) return null;
  const mid = Math.floor(months.length / 2);
  const rate = (subset) => {
    const income = sumBy(transactions, (t) => t.type === "income" && subset.includes(monthKey(t.date)));
    const expense = sumBy(transactions, (t) => t.type === "expense" && subset.includes(monthKey(t.date)));
    return income > 0 ? ((income - expense) / income) * 100 : null;
  };
  const first = rate(months.slice(0, mid));
  const second = rate(months.slice(mid));
  if (first === null || second === null) return null;

  const diff = second - first;
  if (Math.abs(diff) < 3) {
    return { level: "ok", title: "Taxa de poupança estável", desc: `Foi de ${first.toFixed(0)}% para ${second.toFixed(0)}% entre a primeira e a segunda metade do período.` };
  }
  return {
    level: diff > 0 ? "ok" : "warn",
    title: diff > 0 ? "Taxa de poupança melhorando" : "Taxa de poupança piorando",
    desc: `Foi de ${first.toFixed(0)}% para ${second.toFixed(0)}% entre a primeira e a segunda metade do período.`,
  };
}

// Volatilidade de receita: coeficiente de variação da receita mensal — relevante pra
// quem mistura salário fixo com renda variável (freelance, comissão).
const INCOME_VOLATILITY_CV_THRESHOLD = 0.3;

function incomeVolatilityInsight(transactions, months) {
  const monthlyIncome = months.map((m) => sumBy(transactions, (t) => t.type === "income" && monthKey(t.date) === m));
  const active = monthlyIncome.filter((v) => v > 0);
  if (active.length < 3) return null;
  const mean = active.reduce((a, b) => a + b, 0) / active.length;
  if (mean <= 0) return null;
  const variance = active.reduce((s, v) => s + (v - mean) ** 2, 0) / active.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv <= INCOME_VOLATILITY_CV_THRESHOLD) return null;
  return {
    level: "warn",
    title: "Receita irregular",
    desc: `A receita mensal varia bastante no período (coeficiente de variação de ${(cv * 100).toFixed(0)}%) — médias mensais têm menos significado quando a renda oscila assim.`,
  };
}

// `transactions` já filtradas por isCashFlow; `months` é o range em análise (YYYY-MM).
export function computeCashflowInsights(transactions, months) {
  return [
    redMonthsInsight(transactions, months),
    recurringConcentrationInsight(transactions, months),
    othersDominanceInsight(transactions),
    savingsTrendInsight(transactions, months),
    incomeVolatilityInsight(transactions, months),
  ].filter(Boolean);
}

// ============================================================
// Cartão de crédito — mesma ideia, mas sem "receita": o denominador de concentração e
// a tendência comparam contra o próprio gasto médio do cartão, não contra renda.
// ============================================================

function cardRecurringConcentrationInsight(purchases, months) {
  const activeMonths = months.filter((m) => purchases.some((t) => monthKey(t.date) === m)).length || 1;
  const avgSpend = sumBy(purchases, () => true) / activeMonths;
  if (avgSpend <= 0) return null;

  const groups = new Map();
  purchases.forEach((t) => {
    const key = normalizeDescription(t.description) || t.description;
    groups.set(key, (groups.get(key) || 0) + t.amount);
  });
  let top = null;
  groups.forEach((total, key) => { if (!top || total > top.total) top = { key, total }; });
  if (!top) return null;

  const sharePct = (top.total / activeMonths / avgSpend) * 100;
  if (sharePct <= RECURRING_CONCENTRATION_THRESHOLD_PCT) return null;

  return {
    level: "warn",
    title: "Um comerciante domina a fatura",
    desc: `"${top.key}" soma ${sharePct.toFixed(0)}% do gasto médio mensal do cartão no período.`,
  };
}

function cardSpendTrendInsight(purchases, months) {
  if (months.length < 4) return null;
  const mid = Math.floor(months.length / 2);
  const avgOf = (subset) => {
    const total = sumBy(purchases, (t) => subset.includes(monthKey(t.date)));
    const active = subset.filter((m) => purchases.some((t) => monthKey(t.date) === m)).length;
    return active > 0 ? total / active : null;
  };
  const first = avgOf(months.slice(0, mid));
  const second = avgOf(months.slice(mid));
  if (first === null || second === null) return null;

  const diffPct = ((second - first) / first) * 100;
  if (Math.abs(diffPct) < 10) {
    return { level: "ok", title: "Gasto do cartão estável", desc: `Média mensal foi de ${formatBRL(first)} para ${formatBRL(second)} entre a primeira e a segunda metade do período.` };
  }
  return {
    level: diffPct > 0 ? "warn" : "ok",
    title: diffPct > 0 ? "Gasto do cartão subindo" : "Gasto do cartão caindo",
    desc: `Média mensal foi de ${formatBRL(first)} para ${formatBRL(second)} entre a primeira e a segunda metade do período.`,
  };
}

function formatBRL(value) {
  return (value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// `purchases` são só os itens de fatura do tipo "expense" (compras) — a linha de
// pagamento/reconciliação da fatura (`type === "income"`) não é gasto nem estorno de
// verdade, é só o crédito que zera a fatura no próprio arquivo exportado.
export function computeCardInsights(purchases, months) {
  return [
    cardRecurringConcentrationInsight(purchases, months),
    cardSpendTrendInsight(purchases, months),
  ].filter(Boolean);
}
