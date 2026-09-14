import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDescription, detectRecurringGroups, computeSavingsInsights } from "../js/recurring-analysis.js";

test("normalizeDescription: remove datas e IDs longos, preserva o resto como prefixo", () => {
  assert.equal(normalizeDescription("PIX TRANSF ELISETE21/07"), "PIX TRANSF ELISETE");
  assert.equal(normalizeDescription("DA TIM CELU 55144730000"), "DA TIM CELU");
  assert.equal(normalizeDescription("SEGURO CARTAO"), "SEGURO CARTAO");
  assert.equal(normalizeDescription("PIX QRS SEFAZ RJ - 25/12"), "PIX QRS SEFAZ RJ");
});

test("detectRecurringGroups: identifica um lançamento que se repete em vários meses e ignora um evento único", () => {
  const transactions = [
    { id: "1", type: "expense", date: "2026-01-05", description: "SEGURO CARTAO", category: "Assinaturas", amount: 26.15 },
    { id: "2", type: "expense", date: "2026-02-05", description: "SEGURO CARTAO", category: "Assinaturas", amount: 26.15 },
    { id: "3", type: "expense", date: "2026-03-05", description: "SEGURO CARTAO", category: "Assinaturas", amount: 26.15 },
    { id: "4", type: "expense", date: "2026-01-10", description: "COMPRA UNICA LOJA X", category: "Compras", amount: 500 },
  ];
  const groups = detectRecurringGroups(transactions, { months: 12, minOccurrences: 3, endMonth: "2026-03" });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].normalized, "SEGURO CARTAO");
  assert.equal(groups[0].monthsCount, 3);
  assert.equal(groups[0].occurrences, 3);
  assert.equal(Math.round(groups[0].totalAmount * 100) / 100, 78.45);
});

test("detectRecurringGroups: um lançamento com data variável agrupa mesmo mudando o sufixo", () => {
  const transactions = [
    { id: "1", type: "expense", date: "2026-01-01", description: "PIX TRANSF ELISETE01/01", category: "Outros", amount: 250 },
    { id: "2", type: "expense", date: "2026-02-01", description: "PIX TRANSF ELISETE01/02", category: "Outros", amount: 250 },
    { id: "3", type: "expense", date: "2026-03-01", description: "PIX TRANSF ELISETE01/03", category: "Outros", amount: 280 },
  ];
  const groups = detectRecurringGroups(transactions, { months: 12, minOccurrences: 3, endMonth: "2026-03" });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences, 3);
});

test("detectRecurringGroups: ignora transferências (type='transfer')", () => {
  const transactions = [
    { id: "1", type: "transfer", date: "2026-01-01", description: "TRANSFERENCIA X", category: "Transferência", amount: 100 },
    { id: "2", type: "transfer", date: "2026-02-01", description: "TRANSFERENCIA X", category: "Transferência", amount: 100 },
    { id: "3", type: "transfer", date: "2026-03-01", description: "TRANSFERENCIA X", category: "Transferência", amount: 100 },
  ];
  const groups = detectRecurringGroups(transactions, { months: 12, minOccurrences: 3, endMonth: "2026-03" });
  assert.equal(groups.length, 0);
});

test("computeSavingsInsights: sinaliza assinaturas recorrentes com total anualizado", () => {
  const groups = [{
    type: "expense", normalized: "SEGURO CARTAO", sampleDescription: "SEGURO CARTAO",
    category: "Assinaturas", occurrences: 3, monthsCount: 3, totalAmount: 78.45,
    avgAmount: 26.15, monthlyEquivalent: 26.15, amountsChronological: [26.15, 26.15, 26.15],
  }];
  const insights = computeSavingsInsights(groups, 5000);
  assert.ok(insights.some((i) => i.title.toLowerCase().includes("assinatura")));
});

test("computeSavingsInsights: sinaliza custo recorrente subindo de valor", () => {
  const groups = [{
    type: "expense", normalized: "PLANO X", sampleDescription: "PLANO X",
    category: "Outros", occurrences: 6, monthsCount: 6, totalAmount: 600,
    avgAmount: 100, monthlyEquivalent: 100, amountsChronological: [50, 50, 50, 100, 100, 100],
  }];
  const insights = computeSavingsInsights(groups, 5000);
  assert.ok(insights.some((i) => i.title.includes("subindo")));
});

test("computeSavingsInsights: sem grupos, devolve um card informativo neutro", () => {
  const insights = computeSavingsInsights([], 5000);
  assert.equal(insights.length, 1);
  assert.equal(insights[0].level, "info");
});
