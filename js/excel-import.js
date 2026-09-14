// Importação de planilhas Excel (.xlsx/.xls), reaproveitando o mesmo pipeline de
// mapeamento/tipo/categoria/conta do CSV (js/csv-import.js) — a planilha só precisa
// virar um array-de-arrays (uma linha por linha da planilha), o resto é o parser de
// CSV de novo. Usa o SheetJS vendorizado em js/vendor/xlsx.full.min.js (global `XLSX`,
// carregado via <script> clássico em index.html, como o Chart.js).
import { guessMapping, rowsToTransactions } from "./csv-import.js";

// Pura, sem depender do SheetJS — testável isoladamente. `aoa` é um array de arrays
// (uma linha por linha da planilha), como o `XLSX.utils.sheet_to_json(sheet, {header:1})`
// já retorna.
export function aoaToHeadersRows(aoa) {
  if (!aoa || aoa.length === 0) return { headers: [], rows: [] };
  const headers = (aoa[0] || []).map((h) => String(h ?? "").trim());
  const rows = aoa.slice(1)
    .filter((r) => (r || []).some((c) => String(c ?? "").trim() !== ""))
    .map((r) => headers.map((_, i) => (r[i] === undefined || r[i] === null ? "" : String(r[i]).trim())));
  return { headers, rows };
}

export function transactionsFromAoa(aoa, defaultCategory = "Outros", defaultAccount = "Importado (Excel)") {
  const { headers, rows } = aoaToHeadersRows(aoa);
  const mapping = guessMapping(headers);
  return rowsToTransactions(rows, mapping, defaultCategory, defaultAccount);
}

// Lê a primeira planilha de um workbook .xlsx/.xls (ArrayBuffer) e devolve as
// transações já no formato usado pelo resto do app.
export function parseWorkbook(arrayBuffer, defaultCategory = "Outros", defaultAccount = "Importado (Excel)") {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error("Biblioteca de planilhas (XLSX) não carregou.");
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, raw: false, defval: "" });
  return transactionsFromAoa(aoa, defaultCategory, defaultAccount);
}
