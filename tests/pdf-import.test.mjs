import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStatementLines, parsePortfolioLines, looksLikePortfolioStatement, findPortfolioReferenceDate,
} from "../js/pdf-import.js";

test("parseStatementLines: reconhece lançamentos e ignora SALDO DO DIA e rodapé", () => {
  const lines = [
    "data lançamentos valor (R$) saldo (R$)",
    "12/09/2026 SALDO DO DIA 23.187,73",
    "31/12/2025 PIX TRANSF DISTRIB31/12 -650,00",
    "29/12/2025 PIX TRANSF EDUARDO29/12 14.488,20",
    "   EDUARDO PORTO SCHWEDERSKY 056.441.027-69 agência: 8236 conta: 015333-7",
  ];
  const { transactions, warnings } = parseStatementLines(lines);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].type, "expense");
  assert.equal(transactions[0].amount, 650);
  assert.equal(transactions[0].date, "2025-12-31");
  assert.equal(transactions[1].type, "income");
  assert.equal(transactions[1].amount, 14488.2);
  assert.equal(warnings.length, 0);
});

test("parseStatementLines: linha que começa com data mas não bate o padrão completo vira aviso, não trava o resto", () => {
  const lines = [
    "15/12/2025 valor ilegível aqui sem número no fim",
    "16/12/2025 PIX QRS ALGO -10,00",
  ];
  const { transactions, warnings } = parseStatementLines(lines);
  assert.equal(transactions.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /valor ilegível/);
});

test("parseStatementLines: texto que não começa com data é ignorado silenciosamente (não vira aviso)", () => {
  const { transactions, warnings } = parseStatementLines([
    "Consulte a última versão das Condições Gerais da sua Conta.",
  ]);
  assert.equal(transactions.length, 0);
  assert.equal(warnings.length, 0);
});

test("parseStatementLines: valor zero vira aviso em vez de transação silenciosa", () => {
  const { transactions, warnings } = parseStatementLines(["10/01/2026 AJUSTE SEM EFEITO 0,00"]);
  assert.equal(transactions.length, 0);
  assert.equal(warnings.length, 1);
});

// ---- posição consolidada (carteira) ----
// Linhas como o pdf.js entrega o PDF real de "Posição consolidada" do Itaú: a tabela
// por produto sai com as colunas embaralhadas, mas o quadro-resumo por tipo vem numa
// linha bem formada — é dele que a carteira é lida.
const CARTEIRA_LINES = [
  "EDUARDO EXEMPLO agência conta corrente",
  "056.441.027-69 8236 15333-7",
  "Posição consolidada",
  "posição em 31/08/2026",
  "tipo de investimento rendimento (2026) distribuição valor investido",
  "Fundos de Investimento R$ 33.699,65 18,51% R$ 147.221,24",
  "CDB, Renda Fixa e Estruturados R$ 13.320,96 17,41% R$ 138.490,43",
  "Tesouro Direto R$ 21.361,73 46,09% R$ 366.567,53",
  "Ações R$ 49.717,12 17,98% R$ 143.007,05",
  "Investimentos Imobiliários - - -",
  "Previdência - - -",
  "total investido R$ 795.286,25",
];

test("looksLikePortfolioStatement: distingue carteira de extrato", () => {
  assert.equal(looksLikePortfolioStatement(CARTEIRA_LINES), true);
  assert.equal(looksLikePortfolioStatement(["12/09/2026 SALDO DO DIA 23.187,73"]), false);
});

// O pdf.js às vezes devolve um item por glifo; a detecção não pode depender do espaçamento.
test("looksLikePortfolioStatement: tolera texto vindo glifo a glifo", () => {
  assert.equal(looksLikePortfolioStatement(["P o s i ç ã o c o n s o l i d a d a"]), true);
});

test("parsePortfolioLines: lê a carteira por tipo e confere com o total do PDF", () => {
  const { investments, warnings } = parsePortfolioLines(CARTEIRA_LINES);
  assert.deepEqual(investments.map((i) => i.name), [
    "Fundos de Investimento",
    "CDB, Renda Fixa e Estruturados",
    "Tesouro Direto",
    "Ações",
  ]);
  assert.deepEqual(investments.map((i) => i.currentValue), [147221.24, 138490.43, 366567.53, 143007.05]);
  assert.deepEqual(investments.map((i) => i.class), ["fundos", "renda_fixa", "renda_fixa", "acoes"]);
  assert.equal(warnings.length, 0, `avisos inesperados: ${warnings}`);
});

// As colunas do meio do quadro-resumo (rendimento no ano em R$ e fatia da carteira)
// são a única medida de retorno que o PDF traz pronta — sem elas só restaria cotação
// de mercado, que o app não busca.
test("parsePortfolioLines: guarda o rendimento no ano e a distribuição de cada tipo", () => {
  const { investments } = parsePortfolioLines(CARTEIRA_LINES);
  const tesouro = investments.find((i) => i.name === "Tesouro Direto");
  assert.equal(tesouro.yearReturn, 21361.73);
  assert.equal(tesouro.share, 46.09);
  assert.deepEqual(investments.map((i) => i.yearReturn), [33699.65, 13320.96, 21361.73, 49717.12]);
});

test("parsePortfolioLines: lê a data de referência da posição", () => {
  const { referenceDate } = parsePortfolioLines(CARTEIRA_LINES);
  assert.equal(referenceDate, "2026-08-31");
});

test("parsePortfolioLines: sem data de referência, avisa (quem chama usa a data do arquivo)", () => {
  const semData = CARTEIRA_LINES.filter((l) => l !== "posição em 31/08/2026");
  const { referenceDate, warnings } = parsePortfolioLines(semData);
  assert.equal(referenceDate, null);
  assert.equal(warnings.filter((w) => /data de referência/i.test(w)).length, 1);
});

test("findPortfolioReferenceDate: aceita as formas que o PDF usa, inclusive glifo a glifo", () => {
  assert.equal(findPortfolioReferenceDate(["Posição em 31/08/2026"]), "2026-08-31");
  assert.equal(findPortfolioReferenceDate(["P o s i ç ã o e m 3 1 / 0 8 / 2 0 2 6"]), "2026-08-31");
  assert.equal(findPortfolioReferenceDate(["Data base: 30/06/2026"]), "2026-06-30");
  assert.equal(findPortfolioReferenceDate(["período de 01/08/2026 a 31/08/2026"]), "2026-08-31");
  assert.equal(findPortfolioReferenceDate(["Posição consolidada 31/08/2026"]), "2026-08-31");
  assert.equal(findPortfolioReferenceDate(["nada por aqui"]), null);
});

test("parsePortfolioLines: linhas sem valor (Previdência - - -) não viram posição", () => {
  const { investments } = parsePortfolioLines(CARTEIRA_LINES);
  assert.equal(investments.some((i) => /previdência|imobiliári/i.test(i.name)), false);
});

test("parsePortfolioLines: avisa quando a soma não bate com o total do PDF", () => {
  const { warnings } = parsePortfolioLines([
    "Posição consolidada",
    "posição em 31/08/2026",
    "Tesouro Direto R$ 1.000,00 10,00% R$ 100.000,00",
    "total investido R$ 250.000,00",
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /não bate/);
});
