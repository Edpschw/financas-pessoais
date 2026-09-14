import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementLines } from "../js/pdf-import.js";

test("parseStatementLines: reconhece lançamentos e ignora SALDO DO DIA e rodapé", () => {
  const lines = [
    "data lançamentos valor (R$) saldo (R$)",
    "12/09/2026 SALDO DO DIA 23.187,73",
    "31/12/2025 PIX TRANSF DISTRIB31/12 -650,00",
    "29/12/2025 PIX TRANSF EDUARDO29/12 14.488,20",
    "   EDUARDO PORTO SCHWEDERSKY 056.441.027-69 agência: 8236 conta: 015333-7",
  ];
  const { transactions, warnings } = parseStatementLines(lines);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].type, "expense");
  assert.equal(transactions[0].amount, 650);
  assert.equal(transactions[0].date, "2025-12-31");
  assert.equal(transactions[1].type, "income");
  assert.equal(transactions[1].amount, 14488.2);
  assert.equal(warnings.length, 0);
});

test("parseStatementLines: linha que começa com data mas não bate o padrão completo vira aviso, não trava o resto", () => {
  const lines = [
    "15/12/2025 valor ilegível aqui sem número no fim",
    "16/12/2025 PIX QRS ALGO -10,00",
  ];
  const { transactions, warnings } = parseStatementLines(lines);
  assert.equal(transactions.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /valor ilegível/);
});

test("parseStatementLines: texto que não começa com data é ignorado silenciosamente (não vira aviso)", () => {
  const { transactions, warnings } = parseStatementLines([
    "Consulte a última versão das Condições Gerais da sua Conta.",
  ]);
  assert.equal(transactions.length, 0);
  assert.equal(warnings.length, 0);
});

test("parseStatementLines: valor zero vira aviso em vez de transação silenciosa", () => {
  const { transactions, warnings } = parseStatementLines(["10/01/2026 AJUSTE SEM EFEITO 0,00"]);
  assert.equal(transactions.length, 0);
  assert.equal(warnings.length, 1);
});
