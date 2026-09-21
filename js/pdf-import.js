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

// ============================================================
// Posição consolidada (carteira de investimentos em PDF)
// ============================================================
// O Itaú também exporta a carteira em PDF ("Posição consolidada").
//
// Linha do quadro-resumo: "Tesouro Direto R$ 21.361,73 46,09% R$ 366.567,53"
// (tipo, rendimento no ano, distribuição, valor investido). As três colunas numéricas
// são guardadas: o rendimento no ano é a única medida de retorno que o PDF já traz
// pronta — sem ela só restaria cotação de mercado, que o app não busca (é offline).
const SUMMARY_ROW_RE = /^(.+?)\s+R\$\s*(-?[\d.,]+)\s+(-?[\d.,]+)%\s+R\$\s*([\d.,]+)$/;
const TOTAL_RE = /total\s+investido\s+R\$\s*([\d.,]+)/i;

// Data de referência da posição — sem ela a carteira não tem história, só um valor
// solto. O PDF escreve de formas diferentes conforme o documento, e o texto pode vir
// glifo a glifo (ver itemsToLines), por isso o casamento é feito sobre a linha já sem
// espaços. Se nenhuma bater, quem chama usa a data de modificação do arquivo.
const REFERENCE_DATE_PATTERNS = [
  /posi[çc][ãa]oem(\d{2}\/\d{2}\/\d{4})/,
  /posi[çc][ãa]oconsolidada[^\d]{0,20}(\d{2}\/\d{2}\/\d{4})/,
  /per[íi]odode\d{2}\/\d{2}\/\d{4}a(\d{2}\/\d{2}\/\d{4})/,
  /database:?(\d{2}\/\d{2}\/\d{4})/,
  /datadeposi[çc][ãa]o:?(\d{2}\/\d{2}\/\d{4})/,
  /(?:datade)?refer[êe]ncia:?(\d{2}\/\d{2}\/\d{4})/,
];

export function findPortfolioReferenceDate(lines) {
  for (const rawLine of lines) {
    const compact = (rawLine || "").toLowerCase().replace(/\s+/g, "");
    for (const pattern of REFERENCE_DATE_PATTERNS) {
      const match = compact.match(pattern);
      if (match) return normalizeDateToISO(match[1]);
    }
  }
  return null;
}

// O nome do tipo no resumo → classe usada pelo app.
function classFromSummaryLabel(label) {
  const n = label.toLowerCase();
  if (/tesouro/.test(n)) return "renda_fixa";
  if (/cdb|renda fixa|estruturad/.test(n)) return "renda_fixa";
  if (/ação|acao|ações|acoes/.test(n)) return "acoes";
  if (/imobiliár|imobiliar|fii/.test(n)) return "fiis";
  if (/fundo/.test(n)) return "fundos";
  if (/previdência|previdencia|poupança|poupanca/.test(n)) return "outros";
  return "outros";
}

export function looksLikePortfolioStatement(lines) {
  // tolerante a PDF que devolve um item por glifo ("P o s i ç ã o")
  return lines.some((line) => /posi[çc][ãa]oconsolidada/i.test((line || "").replace(/\s+/g, "")));
}

// Lê a "Posição consolidada" do Itaú. A tabela de produtos individuais tem as colunas
// intercaladas de um jeito que não sobrevive à reconstrução de linhas (nome e valores
// se misturam), mas o quadro-resumo por tipo de investimento é uma linha bem formada e
// fecha com o total informado — é dele que sai a carteira.
export function parsePortfolioLines(lines) {
  const investments = [];
  const warnings = [];
  let statedTotal = null;

  for (const rawLine of lines) {
    const line = (rawLine || "").trim();
    if (!line) continue;

    const total = line.match(TOTAL_RE);
    if (total) { statedTotal = parseBrazilianAmount(total[1]); continue; }

    const row = line.match(SUMMARY_ROW_RE);
    if (!row) continue;

    const [, label, rawYearReturn, rawShare, rawValue] = row;
    const name = label.replace(/\s{2,}/g, " ").trim();
    const value = parseBrazilianAmount(rawValue);
    if (!name || !Number.isFinite(value) || value <= 0) continue;
    if (/total/i.test(name)) continue;

    const yearReturn = parseBrazilianAmount(rawYearReturn);
    const share = parseBrazilianAmount(rawShare);
    investments.push({
      name,
      class: classFromSummaryLabel(name),
      currentValue: value,
      // Como impresso no PDF: rendimento em R$ no ano corrente e a fatia da carteira.
      // Nenhum percentual de rentabilidade é derivado daqui — com aporte no meio do
      // ano, rendimento dividido por valor não é retorno, é um número enganoso.
      yearReturn: Number.isFinite(yearReturn) ? yearReturn : null,
      share: Number.isFinite(share) ? share : null,
    });
  }

  const sum = investments.reduce((s, i) => s + i.currentValue, 0);
  if (statedTotal !== null && investments.length > 0 && Math.abs(sum - statedTotal) > 0.05) {
    warnings.push(
      `A soma por tipo de investimento (${sum.toFixed(2)}) não bate com o total informado no PDF (${statedTotal.toFixed(2)}).`
    );
  }
  if (statedTotal !== null && investments.length === 0) {
    warnings.push("O PDF informa um total investido, mas nenhuma linha por tipo de investimento foi reconhecida.");
  }

  const referenceDate = findPortfolioReferenceDate(lines);
  if (!referenceDate && investments.length > 0) {
    warnings.push(
      "Data de referência não encontrada no PDF — a posição foi registrada com a data de modificação do arquivo."
    );
  }

  return { investments, warnings, referenceDate };
}

// Agrupa os "items" de texto posicionado do pdf.js (getTextContent) em linhas visuais,
// por proximidade de coordenada Y, concatenando por ordem X — reconstrução de texto
// padrão para PDFs sem estrutura de tabela real (o pdf.js só expõe glifos posicionados,
// não linhas/colunas prontas).
function itemsToLines(items, yTolerance = 2) {
  const positioned = items
    .filter((it) => (it.str || "").trim() !== "")
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      width: it.width || 0,
      height: it.height || 8,
    }))
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

  // Alguns PDFs (a posição consolidada do Itaú, por exemplo) devolvem um item por
  // glifo. Juntar tudo com espaço quebraria palavras e até números ("1 1.986,35"),
  // então o espaço só entra quando existe um vão horizontal de verdade entre os itens.
  return lines.map((line) => {
    const parts = line.parts.sort((a, b) => a.x - b.x);
    let text = "";
    let previousEnd = null;
    for (const part of parts) {
      if (previousEnd !== null && part.x - previousEnd > Math.max(1, part.height * 0.25)) text += " ";
      text += part.str;
      previousEnd = part.x + part.width;
    }
    return text.replace(/\s{2,}/g, " ").trim();
  });
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

// Um PDF do banco pode ser um extrato (lançamentos) ou a posição consolidada da
// carteira. Decide pelo conteúdo e devolve sempre a mesma forma.
export async function parsePdf(arrayBuffer, defaultAccount = "Importado (PDF)") {
  const lines = await extractLines(arrayBuffer);
  if (looksLikePortfolioStatement(lines)) {
    const { investments, warnings, referenceDate } = parsePortfolioLines(lines);
    return { kind: "portfolio", transactions: [], investments, warnings, portfolioDate: referenceDate };
  }
  const { transactions, warnings } = parseStatementLines(lines, defaultAccount);
  return { kind: "statement", transactions, investments: [], warnings };
}
