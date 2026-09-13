import { monthKey, lastNMonths, todayMonthKey, CLASS_LABELS, RISK_PROFILES, formatCurrency, formatPercent, categoryBreakdown } from "./utils.js";
import { creditCardInvoices } from "./accounts.js";
import { loanMonthlyPayment, remainingBalance } from "./loans.js";

function monthlyTotals(transactions, months) {
  const totals = {};
  months.forEach((m) => (totals[m] = { income: 0, expense: 0 }));
  transactions.forEach((t) => {
    const m = monthKey(t.date);
    if (!totals[m]) return;
    totals[m][t.type] += t.amount;
  });
  return totals;
}

function average(list) {
  if (list.length === 0) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

export function computeOpportunities(state) {
  const { transactions, investments, budgets, settings, bills, accounts, loans } = state;
  const opportunities = [];

  const months3 = lastNMonths(3);
  const totals3 = monthlyTotals(transactions, months3);
  const avgIncome = average(months3.map((m) => totals3[m].income));
  const avgExpense = average(months3.map((m) => totals3[m].expense));
  const avgSurplus = avgIncome - avgExpense;

  const totalInvested = investments.reduce((s, i) => s + i.currentValue, 0);
  const liquidAssets = investments.filter((i) => i.liquidity === "alta").reduce((s, i) => s + i.currentValue, 0);

  // 1. Reserva de emergência
  const emergencyTarget = avgExpense * (settings.emergencyMonths || 6);
  if (avgExpense > 0) {
    if (liquidAssets < emergencyTarget * 0.5) {
      opportunities.push({
        level: "critical",
        title: "Reserva de emergência muito baixa",
        desc: `Você tem ${formatCurrency(liquidAssets)} em ativos de alta liquidez, mas sua meta é ${formatCurrency(emergencyTarget)} (${settings.emergencyMonths} meses de despesas). Priorize aportes em renda fixa líquida (ex: Tesouro Selic, CDB com liquidez diária) antes de investir em ativos de maior risco.`,
      });
    } else if (liquidAssets < emergencyTarget) {
      opportunities.push({
        level: "warning",
        title: "Reserva de emergência incompleta",
        desc: `Faltam ${formatCurrency(emergencyTarget - liquidAssets)} para completar sua reserva de ${settings.emergencyMonths} meses de despesas.`,
      });
    } else if (liquidAssets > emergencyTarget * 2) {
      opportunities.push({
        level: "info",
        title: "Excesso de dinheiro parado em liquidez alta",
        desc: `Sua reserva líquida (${formatCurrency(liquidAssets)}) é bem maior que a meta (${formatCurrency(emergencyTarget)}). Considere alocar o excedente em investimentos de médio/longo prazo com melhor retorno.`,
      });
    }
  }

  // 2. Sobra mensal para investir
  if (avgSurplus > 0) {
    opportunities.push({
      level: "positive",
      title: "Você tem sobra mensal para investir",
      desc: `Nos últimos meses sua renda superou as despesas em média em ${formatCurrency(avgSurplus)}/mês. Considere direcionar esse valor para seus investimentos conforme seu perfil de risco.`,
    });
  } else if (avgSurplus < 0 && avgIncome > 0) {
    opportunities.push({
      level: "critical",
      title: "Despesas maiores que a renda",
      desc: `Nos últimos meses você gastou em média ${formatCurrency(Math.abs(avgSurplus))}/mês a mais do que ganhou. Revise as categorias de maior gasto antes de pensar em novos investimentos.`,
    });
  }

  // 3. Concentração de portfólio
  if (totalInvested > 0) {
    investments.forEach((inv) => {
      const pct = (inv.currentValue / totalInvested) * 100;
      if (pct > 30) {
        opportunities.push({
          level: "warning",
          title: `Concentração alta em "${inv.name}"`,
          desc: `Esse ativo representa ${formatPercent(pct)} do seu patrimônio investido. Concentração acima de 30% em um único ativo aumenta o risco da carteira — avalie diversificar.`,
        });
      }
    });
  }

  // 4. Aderência ao perfil de risco
  if (totalInvested > 0) {
    const target = RISK_PROFILES[settings.riskProfile] || RISK_PROFILES.moderado;
    const byClass = {};
    investments.forEach((i) => { byClass[i.class] = (byClass[i.class] || 0) + i.currentValue; });

    Object.entries(target).forEach(([cls, targetPct]) => {
      const actualPct = ((byClass[cls] || 0) / totalInvested) * 100;
      const diff = actualPct - targetPct;
      if (Math.abs(diff) >= 15) {
        opportunities.push({
          level: "info",
          title: `${CLASS_LABELS[cls]}: ${diff > 0 ? "acima" : "abaixo"} do perfil ${settings.riskProfile}`,
          desc: `Você tem ${formatPercent(actualPct)} em ${CLASS_LABELS[cls]}, contra uma referência de ${formatPercent(targetPct)} para o perfil ${settings.riskProfile}. ${diff > 0 ? "Considere reduzir novos aportes nessa classe." : "Pode ser uma oportunidade para direcionar novos aportes aqui."}`,
        });
      }
    });
  }

  // 5. Orçamento estourado no mês atual
  const currentMonth = todayMonthKey();
  const expenseByCategory = {};
  transactions
    .filter((t) => t.type === "expense" && monthKey(t.date) === currentMonth)
    .flatMap(categoryBreakdown)
    .forEach((s) => { expenseByCategory[s.category] = (expenseByCategory[s.category] || 0) + s.amount; });

  budgets.forEach((b) => {
    const spent = expenseByCategory[b.category] || 0;
    if (b.monthlyLimit > 0 && spent > b.monthlyLimit) {
      opportunities.push({
        level: "warning",
        title: `Orçamento de "${b.category}" estourado`,
        desc: `Gasto no mês: ${formatCurrency(spent)}, limite definido: ${formatCurrency(b.monthlyLimit)}.`,
      });
    }
  });

  // 6. Contas fixas próximas do vencimento (inspirado nas "bills" do Firefly III)
  const today = new Date();
  const currentMonthExpenses = transactions.filter((t) => t.type === "expense" && monthKey(t.date) === currentMonth);
  (bills || []).filter((b) => b.active !== false).forEach((bill) => {
    const alreadyPaid = currentMonthExpenses.some((t) =>
      t.description.toLowerCase().includes(bill.name.toLowerCase()) || t.category === bill.category
    );
    if (alreadyPaid) return;
    const dueDate = new Date(today.getFullYear(), today.getMonth(), bill.dueDay);
    const daysUntilDue = Math.round((dueDate - today) / (1000 * 60 * 60 * 24));
    if (daysUntilDue >= -3 && daysUntilDue <= 5) {
      opportunities.push({
        level: daysUntilDue < 0 ? "critical" : "warning",
        title: daysUntilDue < 0 ? `Conta "${bill.name}" pode estar atrasada` : `Conta "${bill.name}" vence em breve`,
        desc: `Valor previsto: ${formatCurrency(bill.amount)}, vencimento no dia ${bill.dueDay}. Não encontramos um lançamento correspondente este mês.`,
      });
    }
  });

  // 7. Fatura de cartão de crédito alta em relação à renda
  (accounts || []).filter((a) => a.type === "cartao_credito").forEach((acc) => {
    const invoices = creditCardInvoices(state, acc.id);
    const current = invoices[0];
    if (!current || avgIncome <= 0) return;
    const ratio = (current.total / avgIncome) * 100;
    if (ratio >= 50) {
      opportunities.push({
        level: "critical",
        title: `Fatura do cartão "${acc.name}" compromete mais da metade da renda`,
        desc: `A fatura do ciclo atual é ${formatCurrency(current.total)}, ${formatPercent(ratio)} da sua renda média mensal. Avalie renegociar ou reduzir gastos no cartão.`,
      });
    } else if (ratio >= 30) {
      opportunities.push({
        level: "warning",
        title: `Fatura do cartão "${acc.name}" está alta`,
        desc: `A fatura do ciclo atual é ${formatCurrency(current.total)} (${formatPercent(ratio)} da renda média mensal).`,
      });
    }
  });

  // 8. Comprometimento de renda com parcelas de empréstimos/financiamentos
  const activeLoans = (loans || []).filter((l) => remainingBalance(l) > 0);
  if (activeLoans.length > 0 && avgIncome > 0) {
    const totalMonthlyPayment = activeLoans.reduce((s, l) => s + loanMonthlyPayment(l), 0);
    const ratio = (totalMonthlyPayment / avgIncome) * 100;
    if (ratio >= 30) {
      opportunities.push({
        level: ratio >= 50 ? "critical" : "warning",
        title: "Parcelas de empréstimos comprometem boa parte da renda",
        desc: `Suas parcelas somam ${formatCurrency(totalMonthlyPayment)}/mês, ${formatPercent(ratio)} da sua renda média. O recomendado geralmente é manter esse comprometimento abaixo de 30%.`,
      });
    }
  }

  // 9. Proventos/dividendos recebidos no mês (nota informativa/positiva)
  const currentMonthForProceeds = todayMonthKey();
  const proceedsThisMonth = investments.reduce((s, inv) =>
    s + (inv.proceeds || []).filter((p) => monthKey(p.date) === currentMonthForProceeds).reduce((a, p) => a + p.amount, 0), 0);
  if (proceedsThisMonth > 0) {
    opportunities.push({
      level: "positive",
      title: "Proventos recebidos este mês",
      desc: `Você recebeu ${formatCurrency(proceedsThisMonth)} em proventos/dividendos este mês. Considere reinvestir de acordo com seu perfil de risco.`,
    });
  }

  if (opportunities.length === 0) {
    opportunities.push({
      level: "info",
      title: "Sem alertas no momento",
      desc: "Continue registrando suas transações e investimentos para receber recomendações mais precisas.",
    });
  }

  const order = { critical: 0, warning: 1, info: 2, positive: 3 };
  return opportunities.sort((a, b) => order[a.level] - order[b.level]);
}

// Calculadora de independência financeira (FIRE), no espírito da funcionalidade
// equivalente do Ghostfolio: quanto falta acumular e em quantos anos, dado o
// gasto médio, o patrimônio atual, a sobra mensal e uma taxa de retorno esperada.
export function computeFireProjection(state) {
  const { transactions, investments, settings } = state;
  const months3 = lastNMonths(3);
  const totals3 = monthlyTotals(transactions, months3);
  const avgExpense = average(months3.map((m) => totals3[m].expense));
  const avgIncome = average(months3.map((m) => totals3[m].income));
  const monthlyContribution = Math.max(0, avgIncome - avgExpense);

  const withdrawalRate = (settings.fireWithdrawalRate || 4) / 100;
  const annualReturn = (settings.fireExpectedReturn || 6) / 100;
  const monthlyReturn = Math.pow(1 + annualReturn, 1 / 12) - 1;

  const fireNumber = withdrawalRate > 0 ? (avgExpense * 12) / withdrawalRate : 0;
  const currentNetWorth = investments.reduce((s, i) => s + i.currentValue, 0);

  let months = null;
  if (fireNumber > 0) {
    if (currentNetWorth >= fireNumber) {
      months = 0;
    } else if (monthlyContribution <= 0 && monthlyReturn <= 0) {
      months = null; // nunca alcança sem aportes nem rendimento
    } else {
      let balance = currentNetWorth;
      let m = 0;
      const maxMonths = 100 * 12;
      while (balance < fireNumber && m < maxMonths) {
        balance = balance * (1 + monthlyReturn) + monthlyContribution;
        m++;
      }
      months = m >= maxMonths ? null : m;
    }
  }

  return {
    avgExpense,
    monthlyContribution,
    fireNumber,
    currentNetWorth,
    progressPct: fireNumber > 0 ? Math.min(100, (currentNetWorth / fireNumber) * 100) : 0,
    years: months === null ? null : months / 12,
  };
}
