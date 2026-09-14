import { test } from "node:test";
import assert from "node:assert/strict";
import { aoaToHeadersRows, transactionsFromAoa } from "../js/excel-import.js";

test("aoaToHeadersRows: primeira linha vira cabeçalho, resto vira linhas alinhadas por índice", () => {
  const aoa = [
    ["Data", "Descricao", "Valor"],
    ["01/05/2024", "Mercado", "-100,50"],
    ["02/05/2024", "Salario", "5000,00"],
  ];
  const { headers, rows } = aoaToHeadersRows(aoa);
  assert.deepEqual(headers, ["Data", "Descricao", "Valor"]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["01/05/2024", "Mercado", "-100,50"]);
});

test("aoaToHeadersRows: ignora linhas totalmente vazias", () => {
  const aoa = [["Data", "Valor"], ["01/05/2024", "10"], ["", ""], []];
  const { rows } = aoaToHeadersRows(aoa);
  assert.equal(rows.length, 1);
});

test("aoaToHeadersRows: array vazio devolve headers/rows vazios", () => {
  assert.deepEqual(aoaToHeadersRows([]), { headers: [], rows: [] });
});

test("transactionsFromAoa: reconhece colunas e converte igual ao CSV, com rótulo padrão de conta do Excel", () => {
  const aoa = [
    ["date", "description", "type", "amount"],
    ["2025-07-01", "Mercado", "expense", "100"],
    ["2025-07-25", "Salario", "income", "5000"],
  ];
  const txs = transactionsFromAoa(aoa);
  assert.equal(txs.length, 2);
  assert.equal(txs[0].type, "expense");
  assert.equal(txs[1].type, "income");
  assert.equal(txs[0].account, "Importado (Excel)");
});
