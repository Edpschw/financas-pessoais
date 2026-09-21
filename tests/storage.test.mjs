import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// storage.js lê localStorage no momento do import (`let state = load()`), então o
// mock precisa existir antes do import — e cada teste precisa de uma instância nova
// do módulo (import com query string diferente) pra não reaproveitar o estado da
// rodada anterior.
function installLocalStorageMock(seed) {
  const store = new Map();
  if (seed) store.set("financas-pessoais:v1", JSON.stringify(seed));
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

test("Store: recategoriza pela descrição o que já estava salvo, quando a lista de palavras-chave melhora", async () => {
  installLocalStorageMock({
    transactions: [
      { id: "t1", date: "2026-05-06", description: "PRI APLICACAO VILEGE INT", amount: 20000, type: "expense", category: "Outros" },
      { id: "t2", date: "2026-01-30", description: "TED 001.4477.EDUARDO P S", amount: 15407.89, type: "income", category: "Salário" },
    ],
    accounts: [],
    investments: [],
    importedFiles: [],
    settings: {},
  });
  const { Store } = await import(`../js/storage.js?v=${Date.now()}-a`);
  const { transactions } = Store.get();
  assert.equal(transactions.find((t) => t.id === "t1").category, "Investimentos");
  assert.equal(transactions.find((t) => t.id === "t2").category, "Salário");
});

test("Store: não mexe em transação já corretamente categorizada como Investimentos", async () => {
  installLocalStorageMock({
    transactions: [
      { id: "t1", date: "2026-01-01", description: "COR ITAUCOR COMPRA TD", amount: 1000, type: "expense", category: "Investimentos" },
    ],
    accounts: [],
    investments: [],
    importedFiles: [],
    settings: {},
  });
  const { Store } = await import(`../js/storage.js?v=${Date.now()}-b`);
  assert.equal(Store.get().transactions[0].category, "Investimentos");
});
