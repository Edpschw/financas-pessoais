// Importação de extratos em PDF, via pdf.js vendorizado (js/vendor/pdf.min.mjs +
// pdf.worker.min.mjs). O layout foi validado contra extratos reais do Itaú: cada
// lançamento é uma linha "DD/MM/YYYY DESCRIÇÃO VALOR" (valor já vem com sinal),
// intercalada com linhas "SALDO DO DIA" (saldo do dia, não é lançamento) que são
// ignoradas. Uma linha que começa com data mas não bate no padrão completo vira um
// aviso em vez de travar o arquivo inteiro — outros bancos podem ter um layout
// diferente; texto que nem começa com data (cabeçalho, rodapé, texto legal) é
// silenciosamente ignorado, não é aviso.
import { parseBrazilianAmount, normalizeDateToISO } from "./csv-import.js";

const DATE_PREFIX_RE = /^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/;
const FULL_LINE_RE = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d.,]+)$/;
const SKIP_DESCRIPTIONS = new Set(["saldo do dia", "saldo anterior", "saldo atual", "saldo bloqueado"]);

// Pura, sem depender do pdf.js — recebe as linhas de texto já extraídas (uma string
// por linha visual da página) e devolve transações + avisos (linhas que pareciam um
// lançamento, por começarem com data, mas não puderam ser interpretadas).
export function parseStatementLines(lines, defaultAccount = "Importado (PDF)") {
  const transactions = [];
  const warnings = [];

  for (const rawLine of lines) {
    const line = (rawLine || "").trim();
    if (!line || !DATE_PREFIX_RE.test(line)) continue;

    const match = line.match(FULL_LINE_RE);
    if (!match) { warnings.push(line); continue; }

    const [, rawDate, rawDescription, rawAmount] = match;
    const description = rawDescription.trim();
    if (SKIP_DESCRIPTIONS.has(description.toLowerCase())) continue;

    const amount = parseBrazilianAmount(rawAmount);
    if (Number.isNaN(amount) || amount === 0) { warnings.push(line); continue; }

    transactions.push({
      date: normalizeDateToISO(rawDate),
      description,
      amount: Math.abs(amount),
      type: amount < 0 ? "expense" : "income",
      category: "Outros",
      account: defaultAccount,
    });
  }

  return { transactions, warnings };
}

// Agrupa os "items" de texto posicionado do pdf.js (getTextContent) em linhas visuais,
// por proximidade de coordenada Y, concatenando por ordem X — reconstrução de texto
// padrão para PDFs sem estrutura de tabela real (o pdf.js só expõe glifos posicionados,
// não linhas/colunas prontas).
function itemsToLines(items, yTolerance = 2) {
  const positioned = items
    .filter((it) => (it.str || "").trim() !== "")
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines = [];
  let current = null;
  for (const it of positioned) {
    if (!current || Math.abs(current.y - it.y) > yTolerance) {
      current = { y: it.y, parts: [] };
      lines.push(current);
    }
    current.parts.push(it);
  }
  return lines.map((l) =>
    l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ").replace(/\s{2,}/g, " ").trim()
  );
}

let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("./vendor/pdf.min.mjs").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
      return mod;
    });
  }
  return pdfjsLibPromise;
}

// Extrai todas as linhas de texto de um PDF (ArrayBuffer), na ordem das páginas.
export async function extractLines(arrayBuffer) {
  const pdfjsLib = await loadPdfjs();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    allLines.push(...itemsToLines(content.items));
  }
  return allLines;
}

export async function parseStatementPdf(arrayBuffer, defaultAccount = "Importado (PDF)") {
  const lines = await extractLines(arrayBuffer);
  return parseStatementLines(lines, defaultAccount);
}
