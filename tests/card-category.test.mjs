import { test } from "node:test";
import assert from "node:assert/strict";
import { inferCardCategory } from "../js/card-category.js";

test("inferCardCategory: reconhece comerciantes reais por categoria", () => {
  assert.equal(inferCardCategory("Zona Sul Fl 23"), "Alimentação");
  assert.equal(inferCardCategory("Ifd*mr Maki Vegfit Cul"), "Alimentação");
  assert.equal(inferCardCategory("Metro Rj"), "Transporte");
  assert.equal(inferCardCategory("Netflix.com"), "Assinaturas");
  assert.equal(inferCardCategory("Disney Plus"), "Assinaturas");
  assert.equal(inferCardCategory("Anthropic* Claude Sub"), "Assinaturas");
  assert.equal(inferCardCategory("Drogarias Pacheco"), "Saúde");
  assert.equal(inferCardCategory("Lojas Americanas 772"), "Compras");
});

test("inferCardCategory: não confunde Mercado Livre (compras) com supermercado (alimentação)", () => {
  assert.equal(inferCardCategory("Mercado*mercadolivre"), "Compras");
  assert.equal(inferCardCategory("Mercadolivre*izumi124"), "Compras");
});

test("inferCardCategory: não confunde Azul Seguros (seguradora) com companhia aérea (viagem)", () => {
  assert.equal(inferCardCategory("Azul Seguros"), "Seguros");
});

test("inferCardCategory: comerciante sem palavra-chave reconhecida cai em Outros", () => {
  assert.equal(inferCardCategory("Bt Erico Verrisimo"), "Outros");
  assert.equal(inferCardCategory(undefined), "Outros");
});
