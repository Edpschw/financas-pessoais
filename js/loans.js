// Amortização pelo sistema Price (parcelas fixas) — o mesmo usado na maioria dos
// financiamentos/empréstimos consignados no Brasil.
export function monthlyRateFromAnnual(annualPct) {
  return Math.pow(1 + (annualPct || 0) / 100, 1 / 12) - 1;
}

export function pricePayment(principal, annualPct, installments) {
  const i = monthlyRateFromAnnual(annualPct);
  if (installments <= 0) return 0;
  if (i === 0) return principal / installments;
  return (principal * i) / (1 - Math.pow(1 + i, -installments));
}

export function loanMonthlyPayment(loan) {
  return loan.monthlyPayment || pricePayment(loan.principal, loan.annualRatePct, loan.installmentsTotal);
}

export function remainingBalance(loan) {
  const n = loan.installmentsTotal || 0;
  const k = Math.min(loan.paidInstallments || 0, n);
  if (k >= n) return 0;
  const i = monthlyRateFromAnnual(loan.annualRatePct);
  const payment = loanMonthlyPayment(loan);
  if (i === 0) return Math.max(0, loan.principal - payment * k);
  const bal = loan.principal * Math.pow(1 + i, k) - payment * ((Math.pow(1 + i, k) - 1) / i);
  return Math.max(0, bal);
}

export function totalLoansRemaining(loans) {
  return (loans || []).reduce((s, l) => s + remainingBalance(l), 0);
}
