import { test } from "node:test";
import assert from "node:assert/strict";
import { transactionsFromBackupJson, investmentsFromBackupJson, parseBackupJsonText } from "../js/json-import.js";

test("transactionsFromBackupJson: extrai só expense/income válidos, com rótulo padrão de conta", () => {
  const data = {
    transactions: [
      { type: "expense", date: "2026-01-01", description: "Mercado", category: "Alimentação", amount: 100 },
      { type: "income", date: "2026-01-05", description: "Salario", category: "Salário", amount: 5000, account: "Itaú" },
      { type: "transfer", date: "2026-01-06", description: "Transferência", amount: 200 },
      { type: "expense", date: "2026-01-07", description: "Sem valor", amount: 0 },
    ],
  };
  const txs = transactionsFromBackupJson(data);
  assert.equal(txs.length, 2);
  assert.equal(txs[0].account, "Importado (JSON)");
  assert.equal(txs[1].account, "Itaú");
});

test("transactionsFromBackupJson: lida com backup sem a chave transactions", () => {
  assert.deepEqual(transactionsFromBackupJson({}), []);
});

test("investmentsFromBackupJson: devolve a lista de investimentos tal como está", () => {
  const data = { investments: [{ name: "CDB X", class: "renda_fixa", currentValue: 1000 }] };
  assert.deepEqual(investmentsFromBackupJson(data), data.investments);
});

test("parseBackupJsonText: faz o parse do texto e devolve os dois juntos", () => {
  const text = JSON.stringify({
    transactions: [{ type: "income", date: "2026-01-01", description: "X", amount: 10 }],
    investments: [{ name: "Y", currentValue: 500 }],
  });
  const { transactions, investments } = parseBackupJsonText(text);
  assert.equal(transactions.length, 1);
  assert.equal(investments.length, 1);
});
