import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDuplicateTransaction, findDuplicateGroups, addMonths, monthKey, lastNMonths,
  shortMonthLabel, formatCurrency, formatPercent, formatDateBR, isImportedPlaceholderAccount,
} from "../js/utils.js";

test("isDuplicateTransaction: mesma data/valor/descrição/tipo é duplicata", () => {
  const existing = [{ date: "2024-05-01", amount: 50, type: "expense", description: "Uber Viagem" }];
  assert.equal(isDuplicateTransaction({ date: "2024-05-01", amount: 50, type: "expense", description: "uber viagem" }, existing), true);
});

test("isDuplicateTransaction: valor diferente não é duplicata", () => {
  const existing = [{ date: "2024-05-01", amount: 50, type: "expense", description: "Uber Viagem" }];
  assert.equal(isDuplicateTransaction({ date: "2024-05-01", amount: 51, type: "expense", description: "Uber Viagem" }, existing), false);
});

test("findDuplicateGroups: agrupa lançamentos repetidos (mesmo extrato lido 2x)", () => {
  const transactions = [
    { id: "1", date: "2026-01-05", amount: 100, type: "expense", description: "PAY SUPER" },
    { id: "2", date: "2026-01-05", amount: 100, type: "expense", description: "pay super" },
    { id: "3", date: "2026-01-06", amount: 50, type: "expense", description: "Único" },
  ];
  const groups = findDuplicateGroups(transactions);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((t) => t.id).sort(), ["1", "2"]);
});

test("isImportedPlaceholderAccount: reconhece o rótulo padrão de qualquer formato", () => {
  assert.equal(isImportedPlaceholderAccount("Importado (CSV)"), true);
  assert.equal(isImportedPlaceholderAccount("Importado (PDF)"), true);
  assert.equal(isImportedPlaceholderAccount("Importado (Excel)"), true);
  assert.equal(isImportedPlaceholderAccount("Itaú conta corrente"), false);
  assert.equal(isImportedPlaceholderAccount(""), false);
});

test("addMonths / monthKey / lastNMonths básicos", () => {
  assert.equal(addMonths("2024-01", 1), "2024-02");
  assert.equal(addMonths("2024-01", -1), "2023-12");
  assert.equal(monthKey("2024-05-17"), "2024-05");
  assert.deepEqual(lastNMonths(3, "2024-03"), ["2024-01", "2024-02", "2024-03"]);
});

test("shortMonthLabel: rótulo curto para eixo de gráfico", () => {
  assert.match(shortMonthLabel("2026-01"), /\/26$/);
});

test("formatPercent: vírgula decimal, como o resto dos números em pt-BR", () => {
  assert.equal(formatPercent(46.09), "46,1%");
  assert.equal(formatPercent(-3.25), "-3,3%");
  assert.equal(formatPercent(1234.5, 2), "1.234,50%");
});

test("formatadores não quebram com undefined", () => {
  assert.equal(typeof formatCurrency(undefined), "string");
  assert.equal(formatPercent(undefined), "0,0%");
  assert.equal(formatDateBR(""), "");
  assert.equal(formatDateBR("2026-02-03"), "03/02/2026");
});
