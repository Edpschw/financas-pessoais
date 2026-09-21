import { test } from "node:test";
import assert from "node:assert/strict";
import { computeForecast, computeAttractiveness } from "../js/investment-insight.js";

test("computeForecast: renda fixa com taxa e vencimento projeta por juros compostos", () => {
  const inv = { currentValue: 1000, maturity: "2027-09-14", contractedRatePct: 10 };
  const forecast = computeForecast(inv, "2026-09-14");
  assert.equal(forecast.basis, "taxa_contratada");
  assert.ok(Math.abs(forecast.projectedValue - 1100) < 1);
  assert.match(forecast.disclaimer, /taxa contratada/);
});

test("computeForecast: sem taxa/vencimento usa retorno de 12 meses projetado a 1/3/5 anos, com aviso", () => {
  const inv = { currentValue: 1000, returns: { last12Months: { pct: 10, value: 100 } } };
  const forecast = computeForecast(inv, "2026-09-14");
  assert.equal(forecast.basis, "retorno_12m");
  assert.equal(forecast.horizons.length, 3);
  assert.ok(Math.abs(forecast.horizons[0].projectedValue - 1100) < 1);
  assert.match(forecast.disclaimer, /não garante rentabilidade futura/);
});

test("computeForecast: sem taxa nem retorno de 12 meses devolve null em vez de inventar número", () => {
  assert.equal(computeForecast({ currentValue: 1000 }, "2026-09-14"), null);
});

test("computeAttractiveness: renda fixa acima da Selic é atrativo, com o motivo explícito", () => {
  const inv = { name: "CDB X", currentValue: 1000, contractedRatePct: 16 };
  const { level, reasons } = computeAttractiveness(inv, { benchmark: { selicPct: 14, cdiPct: 13.9 } });
  assert.equal(level, "atrativo");
  assert.match(reasons[0], /Selic/);
});

test("computeAttractiveness: fundo abaixo do CDI vira atenção", () => {
  const inv = { name: "Fundo Y", currentValue: 1000, returns: { last12Months: { pct: 5 } } };
  const { level, reasons } = computeAttractiveness(inv, { benchmark: { selicPct: 14, cdiPct: 13.9 } });
  assert.equal(level, "atencao");
  assert.match(reasons[0], /CDI/);
});

test("computeAttractiveness: sem benchmark (offline) cai para comparação com a mediana da carteira", () => {
  const inv = { name: "Fundo A", currentValue: 1000, returns: { last12Months: { pct: 20 } } };
  const peers = [
    { name: "Fundo B", returns: { last12Months: { pct: 5 } } },
    { name: "Fundo C", returns: { last12Months: { pct: 6 } } },
  ];
  const { level, reasons } = computeAttractiveness(inv, { allInvestments: [inv, ...peers] });
  assert.equal(level, "atrativo");
  assert.match(reasons[0], /Sem conexão/);
});

test("computeAttractiveness: concentração acima de 25% da carteira sempre vira atenção", () => {
  const inv = { name: "CDB Grande", currentValue: 30000, contractedRatePct: 20 };
  const { level, reasons } = computeAttractiveness(inv, {
    totalPortfolio: 100000,
    benchmark: { selicPct: 14, cdiPct: 13.9 },
  });
  assert.equal(level, "atencao");
  assert.ok(reasons.some((r) => /Concentra/.test(r)));
});
