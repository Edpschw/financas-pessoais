import { test } from "node:test";
import assert from "node:assert/strict";
import { isInvestmentMovement, isAnalyzableTransaction, INVESTMENT_CATEGORY } from "../js/investment-flow.js";

test("isInvestmentMovement: reconhece compra/resgate de ativos", () => {
  assert.equal(isInvestmentMovement("COR ITAUCOR COMPRA TD"), true);
  assert.equal(isInvestmentMovement("Resgate de título público"), true);
  assert.equal(isInvestmentMovement("Compra de ações XP"), true);
});

test("isInvestmentMovement: não confunde com rendimento/provento recebido (é receita de verdade)", () => {
  assert.equal(isInvestmentMovement("REND PAGO APLIC AUT MAIS"), false);
  assert.equal(isInvestmentMovement("COR JSCP PETR3"), false);
  assert.equal(isInvestmentMovement("COR DIVIDENDOS PETR3"), false);
});

test("isInvestmentMovement: não confunde com lançamentos do dia a dia", () => {
  assert.equal(isInvestmentMovement("PAY SUPER 19/07"), false);
  assert.equal(isInvestmentMovement("PIX TRANSF ELISETE21/07"), false);
  assert.equal(isInvestmentMovement(""), false);
  assert.equal(isInvestmentMovement(undefined), false);
});

test("isAnalyzableTransaction: exclui só a categoria Investimentos", () => {
  assert.equal(isAnalyzableTransaction({ category: INVESTMENT_CATEGORY }), false);
  assert.equal(isAnalyzableTransaction({ category: "Outros" }), true);
  assert.equal(isAnalyzableTransaction({ category: "Alimentação" }), true);
});
