import { monthsBetweenExclusive, todayMonthKey } from "./utils.js";

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Gera as transações pendentes de contas fixas marcadas como "recorrente automática",
// uma por mês decorrido desde a última geração, sem duplicar (rastreado via lastGeneratedMonth
// no próprio bill e via billId na transação gerada).
export function computeDueTransactions(state, currentMonth = todayMonthKey()) {
  const newTransactions = [];
  const billUpdates = [];

  (state.bills || [])
    .filter((b) => b.active !== false && b.autoGenerate)
    .forEach((bill) => {
      const months = bill.lastGeneratedMonth
        ? monthsBetweenExclusive(bill.lastGeneratedMonth, currentMonth)
        : [currentMonth];
      if (months.length === 0) return;
      months.forEach((month) => {
        const [y, m] = month.split("-").map(Number);
        const day = Math.min(bill.dueDay, daysInMonth(y, m));
        const date = `${month}-${String(day).padStart(2, "0")}`;
        newTransactions.push({
          type: "expense",
          date,
          description: bill.name,
          category: bill.category,
          accountId: bill.accountId || "",
          amount: bill.amount,
          billId: bill.id,
        });
      });
      billUpdates.push({ id: bill.id, lastGeneratedMonth: currentMonth });
    });

  return { newTransactions, billUpdates };
}
