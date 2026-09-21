import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// rates.js usa fetch/localStorage globais (do navegador) — mocka os dois antes de
// importar, como o próprio módulo faz no navegador de verdade.
function installLocalStorageMock() {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

const { fetchBenchmarkRates } = await import("../js/rates.js");

beforeEach(() => {
  installLocalStorageMock();
  global.fetch = undefined;
});

test("fetchBenchmarkRates: busca Selic e CDI em paralelo e devolve as taxas atuais", async () => {
  global.fetch = async (url) => {
    if (url.includes("432")) return { ok: true, json: async () => [{ valor: "14.00" }] };
    if (url.includes("4389")) return { ok: true, json: async () => [{ valor: "13.90" }] };
    throw new Error("URL inesperada: " + url);
  };
  const result = await fetchBenchmarkRates();
  assert.equal(result.selicPct, 14.0);
  assert.equal(result.cdiPct, 13.9);
  assert.equal(typeof result.fetchedAt, "number");
});

test("fetchBenchmarkRates: offline (fetch rejeita) devolve null, não lança erro", async () => {
  global.fetch = async () => { throw new Error("network error"); };
  const result = await fetchBenchmarkRates();
  assert.equal(result, null);
});

test("fetchBenchmarkRates: resposta não-ok devolve null pra aquela série sem derrubar a outra", async () => {
  global.fetch = async (url) => {
    if (url.includes("432")) return { ok: false };
    return { ok: true, json: async () => [{ valor: "13.90" }] };
  };
  const result = await fetchBenchmarkRates();
  assert.equal(result.selicPct, null);
  assert.equal(result.cdiPct, 13.9);
});

test("fetchBenchmarkRates: usa cache válido em vez de rebuscar", async () => {
  let callCount = 0;
  global.fetch = async () => { callCount++; return { ok: true, json: async () => [{ valor: "14.00" }] }; };
  const first = await fetchBenchmarkRates();
  assert.equal(callCount, 2); // selic + cdi
  const second = await fetchBenchmarkRates();
  assert.equal(callCount, 2); // não rebuscou
  assert.deepEqual(second, first);
});
