import { test } from "node:test";
import assert from "node:assert/strict";
import { pricePayment, loanMonthlyPayment, remainingBalance, totalLoansRemaining } from "../js/loans.js";

test("pricePayment: taxa zero divide o principal igualmente", () => {
  assert.equal(pricePayment(1200, 0, 12), 100);
});

test("pricePayment: parcela positiva e coerente para taxa > 0", () => {
  const payment = pricePayment(10000, 12, 12);
  // com juros, a soma das parcelas deve superar o principal
  assert.ok(payment * 12 > 10000);
  assert.ok(payment > 800 && payment < 950);
});

test("remainingBalance: some totalmente ao fim das parcelas", () => {
  const loan = { principal: 10000, annualRatePct: 12, installmentsTotal: 12, paidInstallments: 12 };
  assert.equal(remainingBalance(loan), 0);
});

test("remainingBalance: cai progressivamente a cada parcela paga", () => {
  const loan = { principal: 10000, annualRatePct: 12, installmentsTotal: 12, paidInstallments: 0 };
  const balances = [0, 3, 6, 9, 12].map((k) => remainingBalance({ ...loan, paidInstallments: k }));
  for (let i = 1; i < balances.length; i++) assert.ok(balances[i] < balances[i - 1]);
  assert.equal(balances[0], 10000);
});

test("loanMonthlyPayment usa a fórmula Price quando monthlyPayment não é informado", () => {
  const loan = { principal: 5000, annualRatePct: 0, installmentsTotal: 10 };
  assert.equal(loanMonthlyPayment(loan), 500);
});

test("totalLoansRemaining soma o saldo devedor de todos os empréstimos", () => {
  const loans = [
    { principal: 1000, annualRatePct: 0, installmentsTotal: 10, paidInstallments: 5 },
    { principal: 2000, annualRatePct: 0, installmentsTotal: 10, paidInstallments: 10 },
  ];
  assert.equal(totalLoansRemaining(loans), 500);
});
