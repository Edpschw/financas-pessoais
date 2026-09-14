import { test } from "node:test";
import assert from "node:assert/strict";
import {
  xirr, categoryBreakdown, isDuplicateTransaction, findDuplicateGroups, monthsBetweenExclusive,
  addMonths, monthKey, formatCurrency, formatPercent, sha256Hex, clamp,
} from "../js/utils.js";

test("xirr: aporte único que dobra em ~1 ano dá ~100% a.a.", () => {
  const cashflows = [
    { date: "2024-01-01", amount: -1000 },
    { date: "2025-01-01", amount: 2000 },
  ];
  const rate = xirr(cashflows);
  assert.ok(rate > 95 && rate < 105, `esperava ~100%, obteve ${rate}`);
});

test("xirr: menos de 2 fluxos retorna null", () => {
  assert.equal(xirr([{ date: "2024-01-01", amount: -1000 }]), null);
  assert.equal(xirr([]), null);
  assert.equal(xirr(null), null);
});

test("xirr: taxa zero quando não há ganho nem perda", () => {
  const cashflows = [
    { date: "2024-01-01", amount: -1000 },
    { date: "2024-06-01", amount: 1000 },
  ];
  const rate = xirr(cashflows);
  assert.ok(Math.abs(rate) < 0.5, `esperava ~0%, obteve ${rate}`);
});

test("categoryBreakdown: sem splits retorna a categoria única", () => {
  const tx = { category: "Alimentação", amount: 100 };
  assert.deepEqual(categoryBreakdown(tx), [{ category: "Alimentação", amount: 100 }]);
});

test("categoryBreakdown: com splits retorna as divisões", () => {
  const tx = { category: "Múltiplas categorias", amount: 100, splits: [{ category: "A", amount: 60 }, { category: "B", amount: 40 }] };
  assert.deepEqual(categoryBreakdown(tx), tx.splits);
});

test("isDuplicateTransaction: mesma data/valor/descrição/tipo é duplicata", () => {
  const existing = [{ date: "2024-05-01", amount: 50, type: "expense", description: "Uber Viagem" }];
  assert.equal(isDuplicateTransaction({ date: "2024-05-01", amount: 50, type: "expense", description: "uber viagem" }, existing), true);
});

test("isDuplicateTransaction: valor diferente não é duplicata", () => {
  const existing = [{ date: "2024-05-01", amount: 50, type: "expense", description: "Uber Viagem" }];
  assert.equal(isDuplicateTransaction({ date: "2024-05-01", amount: 51, type: "expense", description: "Uber Viagem" }, existing), false);
});

test("findDuplicateGroups: agrupa transações repetidas (ex: mesmo extrato importado 2x)", () => {
  const transactions = [
    { id: "1", date: "2026-01-05", amount: 100, type: "expense", description: "PAY SUPER" },
    { id: "2", date: "2026-01-05", amount: 100, type: "expense", description: "pay super" },
    { id: "3", date: "2026-01-06", amount: 50, type: "expense", description: "Único" },
  ];
  const groups = findDuplicateGroups(transactions);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
  assert.deepEqual(groups[0].map((t) => t.id).sort(), ["1", "2"]);
});

test("findDuplicateGroups: ignora transferências", () => {
  const transactions = [
    { id: "1", date: "2026-01-05", amount: 100, type: "transfer", description: "Transferência" },
    { id: "2", date: "2026-01-05", amount: 100, type: "transfer", description: "Transferência" },
  ];
  assert.deepEqual(findDuplicateGroups(transactions), []);
});

test("monthsBetweenExclusive: lista meses entre from (exclusive) e to (inclusive)", () => {
  assert.deepEqual(monthsBetweenExclusive("2024-01", "2024-04"), ["2024-02", "2024-03", "2024-04"]);
});

test("monthsBetweenExclusive: from null retorna só o mês final", () => {
  assert.deepEqual(monthsBetweenExclusive(null, "2024-04"), ["2024-04"]);
});

test("addMonths / monthKey básicos", () => {
  assert.equal(addMonths("2024-12", 1), "2025-01");
  assert.equal(addMonths("2024-01", -1), "2023-12");
  assert.equal(monthKey("2024-03-15"), "2024-03");
});

test("formatCurrency / formatPercent não quebram com undefined", () => {
  assert.equal(typeof formatCurrency(undefined), "string");
  assert.equal(formatPercent(12.345), "12.3%");
});

test("clamp limita ao intervalo", () => {
  assert.equal(clamp(5, 1, 10), 5);
  assert.equal(clamp(-5, 1, 10), 1);
  assert.equal(clamp(50, 1, 10), 10);
});

test("sha256Hex é determinístico e gera hex de 64 chars", async () => {
  const a = await sha256Hex("1234");
  const b = await sha256Hex("1234");
  const c = await sha256Hex("4321");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});
