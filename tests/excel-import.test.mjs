import { test } from "node:test";
import assert from "node:assert/strict";
import { aoaToHeadersRows, findHeaderRow, looksLikeCardInvoice, transactionsFromAoa } from "../js/excel-import.js";
import { CARD_INVOICE_CATEGORY } from "../js/utils.js";

test("findHeaderRow: acha o cabeçalho quando a tabela começa na primeira linha", () => {
  const aoa = [["Data", "Descricao", "Valor"], ["01/05/2024", "Mercado", "-100,50"]];
  assert.equal(findHeaderRow(aoa), 0);
});

// Exportação de fatura do Itaú: nome/agência/conta antes da tabela de lançamentos.
test("findHeaderRow: pula o bloco de cabeçalho do banco e acha a tabela de verdade", () => {
  const aoa = [
    ["Nome", "Eduardo Porto Schwedersky"],
    ["Agência", "8236"],
    ["Conta", "15333-7"],
    ["Fatura Paga - Agosto/2026"],
    [],
    ["Data", "Lançamento", "Valor", "Parcelamento"],
    ["05/08/2026", "Netflix.com", "55,90", "Única"],
  ];
  assert.equal(findHeaderRow(aoa), 5);
  const { headers, rows } = aoaToHeadersRows(aoa);
  assert.deepEqual(headers, ["Data", "Lançamento", "Valor", "Parcelamento"]);
  assert.equal(rows.length, 1);
});

test("findHeaderRow: devolve -1 quando não existe tabela de lançamentos", () => {
  assert.equal(findHeaderRow([["Nome", "Fulano"], ["Conta", "123"]]), -1);
  assert.deepEqual(aoaToHeadersRows([["Nome", "Fulano"]]), { headers: [], rows: [] });
});

test("looksLikeCardInvoice: reconhece pelo conteúdo ou pelo nome do arquivo", () => {
  assert.equal(looksLikeCardInvoice([["Fatura Paga - Agosto/2026"]]), true);
  assert.equal(looksLikeCardInvoice([["Extrato"]], "fatura-paga-final 4026.xlsx"), true);
  assert.equal(looksLikeCardInvoice([["Extrato conta corrente"]], "extrato.xlsx"), false);
});

test("transactionsFromAoa: fatura vira despesa mesmo com o valor positivo", () => {
  const aoa = [
    ["Fatura Paga - Agosto/2026"],
    ["Data", "Lançamento", "Valor"],
    ["05/08/2026", "Netflix.com", "55,90"],
    ["07/08/2026", "Estorno compra", "-30,00"],
  ];
  const txs = transactionsFromAoa(aoa, { fileName: "fatura-agosto.xlsx" });
  assert.equal(txs.length, 2);
  assert.equal(txs[0].type, "expense");
  assert.equal(txs[0].amount, 55.9);
  assert.equal(txs[0].category, CARD_INVOICE_CATEGORY);
  // valor negativo na fatura é estorno: entra como receita
  assert.equal(txs[1].type, "income");
});

test("transactionsFromAoa: planilha comum mantém a convenção de extrato (negativo = despesa)", () => {
  const aoa = [
    ["date", "description", "type", "amount"],
    ["2025-07-01", "Mercado", "expense", "100"],
    ["2025-07-25", "Salario", "income", "5000"],
  ];
  const txs = transactionsFromAoa(aoa);
  assert.equal(txs[0].type, "expense");
  assert.equal(txs[1].type, "income");
  assert.equal(txs[0].account, "Importado (Excel)");
});
