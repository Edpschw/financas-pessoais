// Detecção de custos/receitas recorrentes e sugestões de economia, a partir do
// histórico de transações. Lógica pura (sem DOM), no mesmo espírito de advisor.js —
// os insights saem no formato {level, title, desc} pra reaproveitar a mesma
// renderização de cards (renderOpportunityCards em app.js).
import { monthKey, lastNMonths, todayMonthKey, formatCurrency, formatPercent } from "./utils.js";

// Remove partes variáveis de uma descrição (datas, IDs/referências longas) pra
// agrupar lançamentos que são "a mesma coisa" mas mudam texto a cada mês — ex:
// "PIX TRANSF ELISETE21/07" e "PIX TRANSF ELISETE18/08" devem cair no mesmo grupo.
export function normalizeDescription(desc) {
  return (desc || "")
    .toUpperCase()
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, "") // datas tipo 21/07 ou 21/07/2025
    .replace(/\b\d{4,}\b/g, "") // IDs/referências longas (linha de telefone, boleto, etc.)
    .replace(/[-–—]+\s*$/g, "") // traço solto (+ espaço) que sobra no fim depois de tirar a data
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Agrupa transações (receita ou despesa) por (tipo, descrição normalizada) dentro da
// janela de meses informada, e mede recorrência. Só devolve grupos que de fato se
// repetem — aparecem em pelo menos `minOccurrences` meses distintos da janela.
export function detectRecurringGroups(transactions, { months = 12, minOccurrences = 3, endMonth = todayMonthKey() } = {}) {
  const validMonths = new Set(lastNMonths(months, endMonth));
  const byKey = new Map();

  transactions.forEach((t) => {
    if (t.type !== "expense" && t.type !== "income") return;
    const m = monthKey(t.date);
    if (!validMonths.has(m)) return;
    const norm = normalizeDescription(t.description);
    if (!norm) return;
    const key = `${t.type}::${norm}`;
    if (!byKey.has(key)) byKey.set(key, { type: t.type, normalized: norm, transactions: [], categories: {} });
    const g = byKey.get(key);
    g.transactions.push(t);
    g.categories[t.category] = (g.categories[t.category] || 0) + 1;
  });

  const groups = [];
  byKey.forEach((g) => {
    const distinctMonths = new Set(g.transactions.map((t) => monthKey(t.date)));
    if (distinctMonths.size < minOccurrences) return;

    const sorted = g.transactions.slice().sort((a, b) => a.date.localeCompare(b.date));
    const totalAmount = sorted.reduce((s, t) => s + t.amount, 0);
    const mostCommonCategory = Object.entries(g.categories).sort((a, b) => b[1] - a[1])[0][0];

    groups.push({
      type: g.type,
      normalized: g.normalized,
      // a descrição normalizada fica meio robótica sem o sufixo de data — mostramos a
      // original mais recente como exemplo legível na UI.
      sampleDescription: sorted[sorted.length - 1].description,
      category: mostCommonCategory,
      occurrences: sorted.length,
      monthsCount: distinctMonths.size,
      totalAmount,
      avgAmount: totalAmount / sorted.length,
      monthlyEquivalent: totalAmount / distinctMonths.size,
      firstDate: sorted[0].date,
      lastDate: sorted[sorted.length - 1].date,
      amountsChronological: sorted.map((t) => t.amount),
      transactionIds: sorted.map((t) => t.id),
    });
  });

  return groups.sort((a, b) => b.totalAmount - a.totalAmount);
}

function average(list) {
  if (list.length === 0) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

const FEE_KEYWORDS = ["seguro", "tarifa", "anuidade", "iof", "manuten"];

// Heurísticas simples de "onde dá pra economizar", a partir dos grupos recorrentes já
// detectados. `avgMonthlyIncome` (opcional) permite comparar um custo recorrente com a
// renda média, pra sinalizar concentração.
export function computeSavingsInsights(groups, avgMonthlyIncome = 0) {
  const insights = [];
  const expenseGroups = groups.filter((g) => g.type === "expense");

  const subscriptions = expenseGroups.filter((g) => g.category === "Assinaturas");
  if (subscriptions.length > 0) {
    const annual = subscriptions.reduce((s, g) => s + g.monthlyEquivalent * 12, 0);
    insights.push({
      level: "info",
      title: `${subscriptions.length} assinatura(s) recorrente(s) somam ${formatCurrency(annual)}/ano`,
      desc: subscriptions.map((g) => `${g.sampleDescription} (~${formatCurrency(g.avgAmount)}/ocorrência)`).join(", "),
    });
  }

  const fees = expenseGroups.filter((g) => FEE_KEYWORDS.some((kw) => g.normalized.toLowerCase().includes(kw)));
  if (fees.length > 0) {
    const annual = fees.reduce((s, g) => s + g.monthlyEquivalent * 12, 0);
    insights.push({
      level: "warning",
      title: `Tarifas/taxas recorrentes somam ${formatCurrency(annual)}/ano`,
      desc: `${fees.map((g) => g.sampleDescription).join(", ")}. Vale conferir se ainda fazem sentido ou se dá pra negociar/cancelar.`,
    });
  }

  expenseGroups.forEach((g) => {
    if (g.occurrences < 6) return;
    const firstThree = average(g.amountsChronological.slice(0, 3));
    const lastThree = average(g.amountsChronological.slice(-3));
    if (firstThree <= 0) return;
    const increase = ((lastThree - firstThree) / firstThree) * 100;
    if (increase >= 15) {
      insights.push({
        level: "warning",
        title: `"${g.sampleDescription}" está subindo de valor`,
        desc: `Foi de ~${formatCurrency(firstThree)} para ~${formatCurrency(lastThree)} por ocorrência (+${formatPercent(increase, 0)}). Vale conferir o motivo do aumento.`,
      });
    }
  });

  if (avgMonthlyIncome > 0 && expenseGroups.length > 0) {
    const top = expenseGroups[0];
    const pct = (top.monthlyEquivalent / avgMonthlyIncome) * 100;
    if (pct >= 15) {
      insights.push({
        level: "warning",
        title: `"${top.sampleDescription}" é seu maior custo recorrente`,
        desc: `Em média ${formatCurrency(top.monthlyEquivalent)}/mês, ${formatPercent(pct)} da sua renda média. Vale revisar se ainda faz sentido nesse valor.`,
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      level: "info",
      title: "Nenhum ponto de atenção nos custos recorrentes",
      desc: "Continue registrando suas transações para identificar padrões de gasto recorrente.",
    });
  }

  return insights;
}
