import { test } from "node:test";
import assert from "node:assert/strict";
import { inferCategory } from "../js/card-category.js";

test("inferCategory: reconhece comerciantes reais por categoria", () => {
  assert.equal(inferCategory("Zona Sul Fl 23"), "Alimentação");
  assert.equal(inferCategory("Ifd*mr Maki Vegfit Cul"), "Alimentação");
  assert.equal(inferCategory("Metro Rj"), "Transporte");
  assert.equal(inferCategory("Netflix.com"), "Assinaturas");
  assert.equal(inferCategory("Disney Plus"), "Assinaturas");
  assert.equal(inferCategory("Anthropic* Claude Sub"), "Assinaturas");
  assert.equal(inferCategory("Drogarias Pacheco"), "Saúde");
  assert.equal(inferCategory("Lojas Americanas 772"), "Compras");
});

test("inferCategory: não confunde Mercado Livre (compras) com supermercado (alimentação)", () => {
  assert.equal(inferCategory("Mercado*mercadolivre"), "Compras");
  assert.equal(inferCategory("Mercadolivre*izumi124"), "Compras");
});

test("inferCategory: não confunde Azul Seguros (seguradora) com companhia aérea (viagem)", () => {
  assert.equal(inferCategory("Azul Seguros"), "Seguros");
});

// Reaproveitado também no extrato (ver extratoTypeKey em app.js), pra boleto/PIX/TED
// que o banco não categoriza: seguradora de boleto e transferência pra Conta Global
// (produto multi-moeda do Itaú) são os dois casos reais que motivaram isso.
test("inferCategory: reconhece boleto de seguradora e transferência internacional (Conta Global) no extrato", () => {
  assert.equal(inferCategory("PAG BOLETO SUHAI SEGURADORA SA"), "Seguros");
  assert.equal(inferCategory("PAG BOLETO PLATACOR CORRETAGEM DE SEGUR"), "Seguros");
  assert.equal(inferCategory("TRANSF CONTA GLOBAL"), "Transferência internacional");
  assert.equal(inferCategory("IOF TRANSF CONTA GLOBAL"), "Transferência internacional");
});

test("inferCategory: comerciante sem palavra-chave reconhecida cai em Outros", () => {
  assert.equal(inferCategory("Bt Erico Verrisimo"), "Outros");
  assert.equal(inferCategory(undefined), "Outros");
});
