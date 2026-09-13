import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDueTransactions } from "../js/recurring.js";

test("computeDueTransactions: gera uma transação para o mês atual na primeira execução", () => {
  const state = { bills: [{ id: "b1", name: "Aluguel", category: "Moradia", amount: 1500, dueDay: 10, autoGenerate: true, active: true, lastGeneratedMonth: null }] };
  const { newTransactions, billUpdates } = computeDueTransactions(state, "2024-05");
  assert.equal(newTransactions.length, 1);
  assert.equal(newTransactions[0].date, "2024-05-10");
  assert.equal(newTransactions[0].billId, "b1");
  assert.equal(billUpdates[0].lastGeneratedMonth, "2024-05");
});

test("computeDueTransactions: não gera de novo se já gerado no mês", () => {
  const state = { bills: [{ id: "b1", name: "Aluguel", category: "Moradia", amount: 1500, dueDay: 10, autoGenerate: true, active: true, lastGeneratedMonth: "2024-05" }] };
  const { newTransactions } = computeDueTransactions(state, "2024-05");
  assert.equal(newTransactions.length, 0);
});

test("computeDueTransactions: preenche meses pulados desde a última geração", () => {
  const state = { bills: [{ id: "b1", name: "Internet", category: "Assinaturas", amount: 100, dueDay: 15, autoGenerate: true, active: true, lastGeneratedMonth: "2024-02" }] };
  const { newTransactions } = computeDueTransactions(state, "2024-05");
  assert.equal(newTransactions.length, 3);
  assert.deepEqual(newTransactions.map((t) => t.date), ["2024-03-15", "2024-04-15", "2024-05-15"]);
});

test("computeDueTransactions: ignora contas sem autoGenerate ou inativas", () => {
  const state = {
    bills: [
      { id: "b1", name: "Manual", category: "Outros", amount: 10, dueDay: 5, autoGenerate: false, active: true, lastGeneratedMonth: null },
      { id: "b2", name: "Inativa", category: "Outros", amount: 10, dueDay: 5, autoGenerate: true, active: false, lastGeneratedMonth: null },
    ],
  };
  const { newTransactions } = computeDueTransactions(state, "2024-05");
  assert.equal(newTransactions.length, 0);
});

test("computeDueTransactions: dia de vencimento maior que os dias do mês é ajustado", () => {
  const state = { bills: [{ id: "b1", name: "Conta", category: "Outros", amount: 10, dueDay: 31, autoGenerate: true, active: true, lastGeneratedMonth: null }] };
  const { newTransactions } = computeDueTransactions(state, "2024-02");
  assert.equal(newTransactions[0].date, "2024-02-29"); // 2024 é bissexto
});
