// Snapshots da carteira: cada posição consolidada lida da pasta é uma foto datada, e
// é a série dessas fotos que dá história à carteira. storage.js fala com o
// localStorage do navegador, então aqui ele roda contra um stub em memória — a lógica
// testada (dedupe por data, ordenação, carteira derivada) é pura.
import { test } from "node:test";
import assert from "node:assert/strict";

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

const { Store } = await import("../js/storage.js");

const AGOSTO = [
  { name: "Tesouro Direto", class: "renda_fixa", currentValue: 366567.53, yearReturn: 21361.73, share: 46.09 },
  { name: "Ações", class: "acoes", currentValue: 143007.05, yearReturn: 49717.12, share: 17.98 },
];
const SETEMBRO = [
  { name: "Tesouro Direto", class: "renda_fixa", currentValue: 370000.0, yearReturn: 24794.2, share: 46.5 },
  { name: "Ações", class: "acoes", currentValue: 150000.0, yearReturn: 56710.07, share: 18.85 },
];

function reset() {
  Store.resetAll();
}

test("recordPortfolioSnapshot: guarda a foto datada e deriva a carteira atual dela", () => {
  reset();
  const result = Store.recordPortfolioSnapshot({ date: "2026-08-31", source: "posicao.pdf", positions: AGOSTO });

  assert.deepEqual(result, { added: 2, updated: 0 });
  const [snapshot] = Store.portfolioHistory();
  assert.equal(snapshot.date, "2026-08-31");
  assert.equal(snapshot.source, "posicao.pdf");
  assert.equal(snapshot.total, 509574.58);

  const investments = Store.get().investments;
  assert.deepEqual(investments.map((i) => i.name), ["Tesouro Direto", "Ações"]);
  assert.equal(investments[0].yearReturn, 21361.73);
  assert.equal(investments[0].share, 46.09);
});

test("recordPortfolioSnapshot: reler o PDF da mesma data substitui a foto, não duplica", () => {
  reset();
  Store.recordPortfolioSnapshot({ date: "2026-08-31", source: "posicao.pdf", positions: AGOSTO });
  const result = Store.recordPortfolioSnapshot({
    date: "2026-08-31",
    source: "posicao-corrigida.pdf",
    positions: [{ name: "Tesouro Direto", class: "renda_fixa", currentValue: 400000 }],
  });

  assert.deepEqual(result, { added: 0, updated: 1 });
  assert.equal(Store.portfolioHistory().length, 1);
  assert.equal(Store.portfolioHistory()[0].total, 400000);
  assert.equal(Store.get().investments.length, 1);
});

// É o ponto do commit: antes, o PDF novo sobrescrevia o valor e o anterior sumia.
test("recordPortfolioSnapshot: datas diferentes viram série ordenada e a carteira é a mais recente", () => {
  reset();
  Store.recordPortfolioSnapshot({ date: "2026-09-30", source: "set.pdf", positions: SETEMBRO });
  Store.recordPortfolioSnapshot({ date: "2026-08-31", source: "ago.pdf", positions: AGOSTO });

  const history = Store.portfolioHistory();
  assert.deepEqual(history.map((s) => s.date), ["2026-08-31", "2026-09-30"]);
  assert.equal(history[0].total, 509574.58);
  assert.equal(history[1].total, 520000);

  const total = Store.get().investments.reduce((sum, i) => sum + i.currentValue, 0);
  assert.equal(total, 520000);
});

test("recordPortfolioSnapshot: posição vinda de backup JSON sobrevive, mas não duplica o que o snapshot traz", () => {
  reset();
  Store.mergeInvestments([
    { name: "Cripto", class: "cripto", currentValue: 5000 },
    { name: "Ações", class: "acoes", currentValue: 1 },
  ]);
  Store.recordPortfolioSnapshot({ date: "2026-08-31", source: "ago.pdf", positions: AGOSTO });

  const names = Store.get().investments.map((i) => i.name);
  assert.deepEqual(names.slice().sort(), ["Ações", "Cripto", "Tesouro Direto"]);
  assert.equal(Store.get().investments.find((i) => i.name === "Ações").currentValue, 143007.05);
});

test("recordPortfolioSnapshot: sem data válida ou sem posição, não grava nada", () => {
  reset();
  assert.deepEqual(Store.recordPortfolioSnapshot({ date: "", positions: AGOSTO }), { added: 0, updated: 0 });
  assert.deepEqual(Store.recordPortfolioSnapshot({ date: "2026-08-31", positions: [] }), { added: 0, updated: 0 });
  assert.equal(Store.portfolioHistory().length, 0);
});

test("snapshots sobrevivem ao recarregar o estado salvo", () => {
  reset();
  Store.recordPortfolioSnapshot({ date: "2026-08-31", source: "ago.pdf", positions: AGOSTO });
  const saved = JSON.parse(memory.get("financas-pessoais:v1"));
  assert.equal(saved.portfolioSnapshots.length, 1);
  assert.equal(saved.portfolioSnapshots[0].positions[0].yearReturn, 21361.73);
});
