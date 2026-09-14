import { test } from "node:test";
import assert from "node:assert/strict";
import { isInvestmentMovement, isProceeds, tagInvestmentMovements } from "../js/investment-flow.js";
import { isCashFlow, INVESTMENT_CATEGORY, CARD_INVOICE_CATEGORY } from "../js/utils.js";

test("isInvestmentMovement: reconhece compra/resgate de ativos", () => {
  assert.equal(isInvestmentMovement("COR ITAUCOR COMPRA TD"), true);
  assert.equal(isInvestmentMovement("Resgate de título público"), true);
  assert.equal(isInvestmentMovement("Compra de ações XP"), true);
});

test("isInvestmentMovement: não confunde com provento recebido nem com gasto do dia a dia", () => {
  assert.equal(isInvestmentMovement("REND PAGO APLIC AUT MAIS"), false);
  assert.equal(isInvestmentMovement("COR JSCP PETR3"), false);
  assert.equal(isInvestmentMovement("PAY SUPER 19/07"), false);
  assert.equal(isInvestmentMovement(undefined), false);
});

test("isProceeds: provento é receita, identificado por categoria ou descrição", () => {
  assert.equal(isProceeds({ type: "income", category: "Rendimentos", description: "qualquer" }), true);
  assert.equal(isProceeds({ type: "income", category: "Outros", description: "COR JSCP PETR3" }), true);
  assert.equal(isProceeds({ type: "income", category: "Outros", description: "COR DIVIDENDOS PETR3" }), true);
  assert.equal(isProceeds({ type: "income", category: "Salário", description: "TED SALARIO" }), false);
  // despesa nunca é provento, mesmo com palavra-chave parecida
  assert.equal(isProceeds({ type: "expense", category: "Outros", description: "COR DIVIDENDOS PETR3" }), false);
});

test("tagInvestmentMovements: marca a compra e deixa o resto intacto", () => {
  const out = tagInvestmentMovements([
    { description: "COR ITAUCOR COMPRA TD", category: "Outros", amount: 1000, type: "expense" },
    { description: "PAY SUPER", category: "Alimentação", amount: 100, type: "expense" },
  ]);
  assert.equal(out[0].category, INVESTMENT_CATEGORY);
  assert.equal(out[1].category, "Alimentação");
});

test("isCashFlow: exclui movimentação de investimento e detalhe de fatura", () => {
  assert.equal(isCashFlow({ category: INVESTMENT_CATEGORY }), false);
  assert.equal(isCashFlow({ category: CARD_INVOICE_CATEGORY }), false);
  assert.equal(isCashFlow({ category: "Alimentação" }), true);
  assert.equal(isCashFlow({ category: "Rendimentos" }), true);
});
