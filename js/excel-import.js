// Importação de planilhas (.xlsx/.xls), reaproveitando o mapeamento de colunas do CSV
// (js/csv-import.js). Duas diferenças em relação a um CSV simples:
//
//  1. A tabela raramente começa na primeira linha — exportações de banco costumam ter
//     um bloco de cabeçalho (nome, agência, conta, título) antes. Por isso procuramos
//     a linha que realmente parece um cabeçalho de tabela de lançamentos.
//  2. Fatura de cartão não traz coluna de tipo e lista tudo positivo: ali um valor
//     positivo é gasto, e negativo é estorno — o inverso da convenção de extrato.
import { guessMapping, rowsToTransactions } from "./csv-import.js";
import { CARD_INVOICE_CATEGORY } from "./utils.js";

// Quantas linhas do topo vasculhar atrás do cabeçalho antes de desistir.
const HEADER_SEARCH_DEPTH = 30;

function cell(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

// Pura, sem depender do SheetJS — `aoa` é um array de arrays (uma linha por linha da
// planilha), como `XLSX.utils.sheet_to_json(sheet, {header:1})` devolve.
export function findHeaderRow(aoa) {
  const limit = Math.min(aoa.length, HEADER_SEARCH_DEPTH);
  for (let i = 0; i < limit; i++) {
    const headers = (aoa[i] || []).map(cell);
    if (headers.filter(Boolean).length < 2) continue;
    const mapping = guessMapping(headers);
    // um cabeçalho de lançamentos precisa ter data e (valor ou descrição)
    if (mapping.date >= 0 && (mapping.amount >= 0 || mapping.description >= 0)) return i;
  }
  return -1;
}

export function aoaToHeadersRows(aoa) {
  const headerIndex = findHeaderRow(aoa);
  if (headerIndex < 0) return { headers: [], rows: [] };
  const headers = (aoa[headerIndex] || []).map(cell);
  const rows = aoa.slice(headerIndex + 1)
    .filter((r) => (r || []).some((c) => cell(c) !== ""))
    .map((r) => headers.map((_, i) => cell(r[i])));
  return { headers, rows };
}

// Fatura de cartão: o arquivo se identifica no próprio conteúdo ("Fatura Paga - ...")
// ou no nome do arquivo.
export function looksLikeCardInvoice(aoa, fileName = "") {
  if (/fatura/i.test(fileName)) return true;
  return aoa.slice(0, HEADER_SEARCH_DEPTH)
    .some((row) => (row || []).some((c) => /fatura/i.test(cell(c))));
}

export function transactionsFromAoa(aoa, { fileName = "", defaultAccount = "Importado (Excel)" } = {}) {
  const { headers, rows } = aoaToHeadersRows(aoa);
  if (headers.length === 0) return [];
  const mapping = guessMapping(headers);
  const invoice = looksLikeCardInvoice(aoa, fileName);

  const transactions = rowsToTransactions(
    rows,
    mapping,
    invoice ? CARD_INVOICE_CATEGORY : "Outros",
    invoice ? "Cartão de crédito" : defaultAccount,
  );

  if (!invoice) return transactions;

  // Na fatura, o sinal é invertido em relação ao extrato: compra vem positiva.
  // rowsToTransactions já usou o sinal para decidir income/expense, então basta trocar.
  return transactions.map((tx) => ({
    ...tx,
    type: tx.type === "income" ? "expense" : "income",
    category: CARD_INVOICE_CATEGORY,
  }));
}

// Lê a primeira planilha de um workbook (ArrayBuffer) e devolve as transações.
export function parseWorkbook(arrayBuffer, { fileName = "", defaultAccount = "Importado (Excel)" } = {}) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error("Biblioteca de planilhas (XLSX) não carregou.");
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, raw: false, defval: "" });
  return transactionsFromAoa(aoa, { fileName, defaultAccount });
}
