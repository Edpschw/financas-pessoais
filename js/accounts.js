import { totalLoansRemaining } from "./loans.js";

export function accountBalance(state, accountId) {
  const account = state.accounts.find((a) => a.id === accountId);
  let balance = account ? (account.initialBalance || 0) : 0;
  state.transactions.forEach((t) => {
    if (t.type === "income" && t.accountId === accountId) balance += t.amount;
    else if (t.type === "expense" && t.accountId === accountId) balance -= t.amount;
    else if (t.type === "transfer") {
      if (t.accountId === accountId) balance -= t.amount;
      if (t.toAccountId === accountId) balance += t.amount;
    }
  });
  return balance;
}

export function allAccountBalances(state) {
  return state.accounts.map((a) => ({ account: a, balance: accountBalance(state, a.id) }));
}

// Ciclo de fatura de cartão de crédito: se o dia da compra é depois do fechamento,
// ela entra na fatura do mês seguinte.
export function billingCycleOf(dateStr, closingDay) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (d > closingDay) {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return `${ny}-${String(nm).padStart(2, "0")}`;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function creditCardInvoices(state, accountId) {
  const account = state.accounts.find((a) => a.id === accountId);
  const closingDay = (account && account.closingDay) || 1;
  const groups = {};
  state.transactions
    .filter((t) => t.type === "expense" && t.accountId === accountId)
    .forEach((t) => {
      const cycle = billingCycleOf(t.date, closingDay);
      groups[cycle] = (groups[cycle] || 0) + t.amount;
    });
  return Object.entries(groups)
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

// Patrimônio líquido total = saldos de conta (exceto cartão, que representa dívida)
// + valor atual dos investimentos - saldo devedor de empréstimos - fatura de cartões em aberto.
export function netWorthTotal(state) {
  let cashTotal = 0;
  let cardDebt = 0;
  state.accounts.forEach((a) => {
    const bal = accountBalance(state, a.id);
    if (a.type === "cartao_credito") cardDebt += Math.max(0, -bal);
    else cashTotal += bal;
  });
  const investedTotal = state.investments.reduce((s, i) => s + (i.currentValue || 0), 0);
  const loansTotal = totalLoansRemaining(state.loans);
  return cashTotal + investedTotal - cardDebt - loansTotal;
}
