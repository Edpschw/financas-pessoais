import { test } from "node:test";
import assert from "node:assert/strict";
import { accountBalance, billingCycleOf, creditCardInvoices, netWorthTotal } from "../js/accounts.js";

function baseState(overrides = {}) {
  return {
    accounts: [], transactions: [], investments: [], loans: [], ...overrides,
  };
}

test("accountBalance: soma saldo inicial + receitas - despesas", () => {
  const state = baseState({
    accounts: [{ id: "a1", initialBalance: 100 }],
    transactions: [
      { type: "income", accountId: "a1", amount: 50 },
      { type: "expense", accountId: "a1", amount: 30 },
    ],
  });
  assert.equal(accountBalance(state, "a1"), 120);
});

test("accountBalance: transferência sai da origem e entra no destino", () => {
  const state = baseState({
    accounts: [{ id: "a1", initialBalance: 100 }, { id: "a2", initialBalance: 0 }],
    transactions: [{ type: "transfer", accountId: "a1", toAccountId: "a2", amount: 40 }],
  });
  assert.equal(accountBalance(state, "a1"), 60);
  assert.equal(accountBalance(state, "a2"), 40);
});

test("billingCycleOf: compra após o fechamento cai na fatura do mês seguinte", () => {
  assert.equal(billingCycleOf("2024-05-10", 5), "2024-06");
  assert.equal(billingCycleOf("2024-05-05", 5), "2024-05");
});

test("creditCardInvoices: agrupa despesas do cartão por ciclo de fatura", () => {
  const state = baseState({
    accounts: [{ id: "card", type: "cartao_credito", closingDay: 10 }],
    transactions: [
      { type: "expense", accountId: "card", amount: 100, date: "2024-05-05" },
      { type: "expense", accountId: "card", amount: 50, date: "2024-05-15" },
    ],
  });
  const invoices = creditCardInvoices(state, "card");
  const may = invoices.find((i) => i.month === "2024-05");
  const june = invoices.find((i) => i.month === "2024-06");
  assert.equal(may.total, 100);
  assert.equal(june.total, 50);
});

test("netWorthTotal: contas + investimentos - dívida de cartão - empréstimos", () => {
  const state = baseState({
    accounts: [
      { id: "a1", type: "corrente", initialBalance: 1000 },
      { id: "card", type: "cartao_credito", initialBalance: 0 },
    ],
    transactions: [{ type: "expense", accountId: "card", amount: 300, date: "2024-05-05" }],
    investments: [{ currentValue: 500 }],
    loans: [{ principal: 1000, annualRatePct: 0, installmentsTotal: 10, paidInstallments: 0 }],
  });
  // 1000 (conta) + 500 (investimentos) - 300 (fatura em aberto) - 1000 (empréstimo) = 200
  assert.equal(netWorthTotal(state), 200);
});
