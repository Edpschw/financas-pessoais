import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, guessMapping, rowsToTransactions } from "../js/csv-import.js";

test("parseCSV: detecta delimitador ; e separa cabeçalho/linhas", () => {
  const text = "Data;Descricao;Valor\n01/05/2024;Mercado;-100,50\n02/05/2024;Salario;5000,00\n";
  const { headers, rows } = parseCSV(text);
  assert.deepEqual(headers, ["Data", "Descricao", "Valor"]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["01/05/2024", "Mercado", "-100,50"]);
});

test("parseCSV: lida com campos entre aspas contendo o delimitador", () => {
  const text = 'Data,Descricao,Valor\n01/05/2024,"Compra, com virgula",-10,00\n';
  const { rows } = parseCSV(text);
  assert.equal(rows[0][1], "Compra, com virgula");
});

test("guessMapping: identifica colunas por nome em português/inglês", () => {
  const mapping = guessMapping(["Data", "Historico", "Valor (R$)"]);
  assert.equal(mapping.date, 0);
  assert.equal(mapping.description, 1);
  assert.equal(mapping.amount, 2);
});

test("guessMapping: retorna -1 quando não encontra a coluna", () => {
  const mapping = guessMapping(["Coluna A", "Coluna B"]);
  assert.equal(mapping.date, -1);
});

test("rowsToTransactions: converte valor BR, normaliza data e infere tipo pelo sinal", () => {
  const rows = [
    ["01/05/2024", "Mercado", "-1.234,50"],
    ["02/05/2024", "Salario", "5000,00"],
  ];
  const mapping = { date: 0, description: 1, amount: 2 };
  const txs = rowsToTransactions(rows, mapping);
  assert.equal(txs.length, 2);
  assert.equal(txs[0].date, "2024-05-01");
  assert.equal(txs[0].amount, 1234.5);
  assert.equal(txs[0].type, "expense");
  assert.equal(txs[1].type, "income");
});

test("rowsToTransactions: ignora linhas com valor zero, inválido ou sem data", () => {
  const rows = [
    ["01/05/2024", "Sem valor", ""],
    ["", "Sem data", "10,00"],
    ["01/05/2024", "Valor zero", "0,00"],
  ];
  const mapping = { date: 0, description: 1, amount: 2 };
  assert.deepEqual(rowsToTransactions(rows, mapping), []);
});
