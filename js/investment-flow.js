// Classificação dos lançamentos que têm a ver com investimentos, a partir da descrição
// do extrato. Duas coisas diferentes, que não podem ser confundidas:
//
//  1. MOVIMENTAÇÃO de principal (comprar/resgatar um ativo) — dinheiro mudando de
//     lugar, não é gasto nem renda. Fica de fora das somas de receita/despesa, senão
//     uma aplicação grande de uma vez distorce o mês inteiro.
//  2. PROVENTO recebido (dividendo, JCP, rendimento) — receita de verdade: o dinheiro
//     entrou na conta. Conta como receita e ainda aparece destacado na aba de
//     investimentos.

const MOVEMENT_KEYWORDS = [
  "compra td", "compra de td", "compra tesouro", "compra de tesouro",
  "compra de titulo", "compra titulo", "compra de acao", "compra de acoes",
  "compra de cota", "compra de cotas", "compra de fundo",
  "itaucor compra", "itaucor resgate", "itaucor aplicacao",
  "resgate td", "resgate tesouro", "resgate de titulo", "resgate titulo",
  "resgate de fundo", "resgate fundo", "resgate de cota", "resgate de aplicacao",
  "aplicacao cdb", "compra cdb", "resgate cdb",
];

const PROCEEDS_KEYWORDS = ["jscp", "dividendo", "provento", "juros sobre capital", "rend pago", "rendimento"];

// Faixa Unicode das marcas de acento combinantes (0x0300-0x036f), construída por
// código de caractere em vez de escrita literal no código-fonte — mais seguro contra
// corrupção por editor/encoding do que colar os caracteres combinantes de verdade.
const DIACRITICS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

function normalize(desc) {
  return (desc || "").toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "");
}

import { INVESTMENT_CATEGORY } from "./utils.js";

export const PROCEEDS_CATEGORY = "Rendimentos";

export function isInvestmentMovement(description) {
  const text = normalize(description);
  return MOVEMENT_KEYWORDS.some((kw) => text.includes(kw));
}

export function isProceeds(transaction) {
  if (!transaction || transaction.type !== "income") return false;
  if (transaction.category === PROCEEDS_CATEGORY) return true;
  const text = normalize(transaction.description);
  return PROCEEDS_KEYWORDS.some((kw) => text.includes(kw));
}

// Marca (não apaga) os lançamentos de movimentação de principal, para que as somas de
// fluxo possam ignorá-los (ver isCashFlow em utils.js).
export function tagInvestmentMovements(transactions) {
  return transactions.map((tx) => (
    isInvestmentMovement(tx.description) ? { ...tx, category: INVESTMENT_CATEGORY } : tx
  ));
}
