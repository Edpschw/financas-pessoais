import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCashflowInsights, computeCardInsights } from "../js/cashflow-insight.js";

function tx(overrides) {
  return { date: "2026-01-15", type: "expense", category: "Outros", description: "X", amount: 100, ...overrides };
}

test("computeCashflowInsights: sinaliza meses no vermelho", () => {
  const months = ["2026-01", "2026-02"];
  const transactions = [
    tx({ date: "2026-01-05", type: "income", amount: 1000 }),
    tx({ date: "2026-01-10", type: "expense", amount: 2000 }),
    tx({ date: "2026-02-05", type: "income", amount: 1000 }),
    tx({ date: "2026-02-10", type: "expense", amount: 500 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  const red = insights.find((i) => /vermelho/.test(i.title));
  assert.ok(red, "deveria ter um cartão de meses no vermelho");
  assert.match(red.desc, /2026-01/);
  assert.doesNotMatch(red.desc, /2026-02/);
});

test("computeCashflowInsights: nenhum mês no vermelho quando receita sempre cobre despesa", () => {
  const months = ["2026-01"];
  const transactions = [
    tx({ date: "2026-01-05", type: "income", amount: 1000 }),
    tx({ date: "2026-01-10", type: "expense", amount: 500 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  const redOk = insights.find((i) => /vermelho/.test(i.title));
  assert.equal(redOk.level, "ok");
});

test("computeCashflowInsights: concentração de despesa recorrente acima de 15% da receita média", () => {
  const months = ["2026-01"];
  const transactions = [
    tx({ date: "2026-01-01", type: "income", amount: 1000 }),
    tx({ date: "2026-01-05", description: "PIX TRANSF HARIANN", amount: 300 }),
    tx({ date: "2026-01-10", description: "PADARIA", amount: 20 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  const concentration = insights.find((i) => /gasto recorrente/.test(i.title));
  assert.ok(concentration);
  assert.match(concentration.desc, /HARIANN/);
});

test("computeCashflowInsights: categoria Outros dominante gera aviso de categorização fraca", () => {
  const months = ["2026-01"];
  const transactions = [
    tx({ date: "2026-01-05", category: "Outros", amount: 800 }),
    tx({ date: "2026-01-06", category: "Alimentação", amount: 100 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  assert.ok(insights.some((i) => /"Outros" concentra/.test(i.title)));
});

test("computeCashflowInsights: categoria Outros minoritária não gera aviso", () => {
  const months = ["2026-01"];
  const transactions = [
    tx({ date: "2026-01-05", category: "Outros", amount: 10 }),
    tx({ date: "2026-01-06", category: "Alimentação", amount: 900 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  assert.ok(!insights.some((i) => /"Outros" concentra/.test(i.title)));
});

// O extrato não categoriza boleto/PIX (só salário/freelance vêm prontos do banco) —
// a dominância de "Outros" usa a mesma inferência por palavra-chave do painel
// "Despesas por tipo" (extratoTypeKey em app.js), senão o aviso contaria um "Outros"
// maior do que o que a pessoa vê na tela logo abaixo.
test("computeCashflowInsights: 'Outros' reconhecido por palavra-chave (ex: boleto de seguradora) não conta pra dominância", () => {
  const months = ["2026-01"];
  const transactions = [
    tx({ date: "2026-01-05", category: "Outros", description: "PAG BOLETO SUHAI SEGURADORA SA", amount: 800 }),
    tx({ date: "2026-01-06", category: "Alimentação", amount: 900 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  assert.ok(!insights.some((i) => /"Outros" concentra/.test(i.title)));
});

test("computeCashflowInsights: tendência de poupança piorando entre as duas metades do período", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
  const transactions = [
    tx({ date: "2026-01-01", type: "income", amount: 1000 }),
    tx({ date: "2026-01-10", type: "expense", amount: 200 }),
    tx({ date: "2026-02-01", type: "income", amount: 1000 }),
    tx({ date: "2026-02-10", type: "expense", amount: 200 }),
    tx({ date: "2026-03-01", type: "income", amount: 1000 }),
    tx({ date: "2026-03-10", type: "expense", amount: 800 }),
    tx({ date: "2026-04-01", type: "income", amount: 1000 }),
    tx({ date: "2026-04-10", type: "expense", amount: 800 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  const trend = insights.find((i) => /poupança/.test(i.title));
  assert.ok(trend);
  assert.equal(trend.level, "warn");
  assert.match(trend.title, /piorando/);
});

test("computeCashflowInsights: receita irregular (alto coeficiente de variação) gera aviso", () => {
  const months = ["2026-01", "2026-02", "2026-03"];
  const transactions = [
    tx({ date: "2026-01-01", type: "income", amount: 100 }),
    tx({ date: "2026-02-01", type: "income", amount: 3000 }),
    tx({ date: "2026-03-01", type: "income", amount: 200 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  assert.ok(insights.some((i) => /Receita irregular/.test(i.title)));
});

test("computeCashflowInsights: receita estável não gera aviso de irregularidade", () => {
  const months = ["2026-01", "2026-02", "2026-03"];
  const transactions = [
    tx({ date: "2026-01-01", type: "income", amount: 1000 }),
    tx({ date: "2026-02-01", type: "income", amount: 1050 }),
    tx({ date: "2026-03-01", type: "income", amount: 980 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  assert.ok(!insights.some((i) => /Receita irregular/.test(i.title)));
});

// Um PIX/TED de valor muito acima do lançamento típico sem categoria pode ser
// transferência entre contas próprias — o app não sabe o nome do titular pra
// confirmar, então avisa sem afirmar.
test("computeCashflowInsights: receita 'Outros' muito maior que a típica gera aviso pra conferir", () => {
  const months = ["2026-01"];
  const transactions = [
    tx({ date: "2026-01-02", type: "income", category: "Outros", description: "PIX TRANSF EDUARDO", amount: 16000 }),
    tx({ date: "2026-01-05", type: "income", category: "Outros", description: "REND PAGO APLIC AUT MAIS", amount: 50 }),
    tx({ date: "2026-01-06", type: "income", category: "Outros", description: "REND PAGO APLIC AUT MAIS", amount: 60 }),
    tx({ date: "2026-01-07", type: "income", category: "Outros", description: "REND PAGO APLIC AUT MAIS", amount: 40 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  const outlier = insights.find((i) => /sem origem identificada/.test(i.title));
  assert.ok(outlier);
  assert.match(outlier.desc, /EDUARDO/);
});

test("computeCashflowInsights: receitas 'Outros' de valor parecido não geram aviso de origem", () => {
  const months = ["2026-01"];
  const transactions = [
    tx({ date: "2026-01-02", type: "income", category: "Outros", description: "PIX TRANSF A", amount: 500 }),
    tx({ date: "2026-01-05", type: "income", category: "Outros", description: "PIX TRANSF B", amount: 450 }),
    tx({ date: "2026-01-06", type: "income", category: "Outros", description: "PIX TRANSF C", amount: 600 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  assert.ok(!insights.some((i) => /sem origem identificada/.test(i.title)));
});

test("computeCashflowInsights: receita 'Outros' grande mas reconhecida por palavra-chave não conta como não identificada", () => {
  const months = ["2026-01"];
  const transactions = [
    tx({ date: "2026-01-02", type: "income", category: "Outros", description: "TRANSF CONTA GLOBAL", amount: 16000 }),
    tx({ date: "2026-01-05", type: "income", category: "Outros", description: "REND PAGO APLIC AUT MAIS", amount: 50 }),
    tx({ date: "2026-01-06", type: "income", category: "Outros", description: "REND PAGO APLIC AUT MAIS", amount: 60 }),
    tx({ date: "2026-01-07", type: "income", category: "Outros", description: "REND PAGO APLIC AUT MAIS", amount: 40 }),
  ];
  const insights = computeCashflowInsights(transactions, months);
  assert.ok(!insights.some((i) => /sem origem identificada/.test(i.title)));
});

// ---- cartão de crédito ----

test("computeCardInsights: um comerciante concentra mais de 15% do gasto médio mensal do cartão", () => {
  const months = ["2026-01"];
  const purchases = [
    tx({ date: "2026-01-05", description: "Netflix.com", amount: 300 }),
    tx({ date: "2026-01-10", description: "Padaria", amount: 50 }),
  ];
  const insights = computeCardInsights(purchases, months);
  const concentration = insights.find((i) => /comerciante domina/.test(i.title));
  assert.ok(concentration);
  assert.match(concentration.desc, /NETFLIX/i);
});

test("computeCardInsights: nenhum comerciante dominante não gera aviso de concentração", () => {
  const months = ["2026-01"];
  const purchases = Array.from({ length: 8 }, (_, i) => tx({ date: "2026-01-05", description: `Loja ${i}`, amount: 50 }));
  const insights = computeCardInsights(purchases, months);
  assert.ok(!insights.some((i) => /comerciante domina/.test(i.title)));
});

test("computeCardInsights: gasto do cartão subindo entre a primeira e a segunda metade do período", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
  const purchases = [
    tx({ date: "2026-01-10", amount: 200 }),
    tx({ date: "2026-02-10", amount: 200 }),
    tx({ date: "2026-03-10", amount: 800 }),
    tx({ date: "2026-04-10", amount: 800 }),
  ];
  const insights = computeCardInsights(purchases, months);
  const trend = insights.find((i) => /Gasto do cartão/.test(i.title));
  assert.ok(trend);
  assert.equal(trend.level, "warn");
  assert.match(trend.title, /subindo/);
});

test("computeCardInsights: sem compras suficientes (período curto) não gera tendência", () => {
  const months = ["2026-01", "2026-02"];
  const purchases = [tx({ date: "2026-01-10", amount: 200 })];
  const insights = computeCardInsights(purchases, months);
  assert.ok(!insights.some((i) => /Gasto do cartão/.test(i.title)));
});
