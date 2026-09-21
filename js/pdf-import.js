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
// O Itaú também exporta a carteira em PDF ("Posição consolidada"), com duas tabelas:
// uma por produto individual (mais rica, mas frágil de reconstruir — ver
// parsePortfolioDetail) e um quadro-resumo por tipo de investimento (mais simples e
// sempre correto — parsePortfolioLines). Usamos o detalhe quando ele bate com o
// resumo; senão, caímos pro resumo, que nunca falha.
//
// Linha do quadro-resumo: "Tesouro Direto R$ 21.361,73 46,09% R$ 366.567,53"
// (tipo, rendimento no ano, distribuição, valor investido).
const SUMMARY_ROW_RE = /^(.+?)\s+R\$\s*(-?[\d.,]+)\s+(-?[\d.,]+)%\s+R\$\s*([\d.,]+)$/;
const TOTAL_RE = /total\s+investido\s+R\$\s*([\d.,]+)/i;

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
// fecha com o total informado — é dele que sai a carteira, como rede de segurança.
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

    const [, label, , , rawValue] = row;
    const name = label.replace(/\s{2,}/g, " ").trim();
    const value = parseBrazilianAmount(rawValue);
    if (!name || !Number.isFinite(value) || value <= 0) continue;
    if (/total/i.test(name)) continue;

    investments.push({ name, class: classFromSummaryLabel(name), currentValue: value });
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

  return { investments, warnings, statedTotal };
}

// ---- detalhe por posição individual ----
// Cada produto ocupa várias linhas visuais (nome quebra em 2-4 linhas; cada coluna de
// rentabilidade também quebra em sub-linhas de R$ e %), mas a posição X de cada coluna
// é estável dentro do documento — inclusive pra quem não tem rentabilidade (CDB/Tesouro
// mostram "-" nas mesmas colunas X das ações/fundos). Em vez de tentar casar isso com o
// texto do cabeçalho (que também quebra de um jeito difícil de seguir e repete palavras
// como "atual" em "mês atual" e "ano atual"), as colunas são descobertas pela própria
// posição X das células de dado (valor, %, "-"): a mais à direita é sempre "valor
// investido" (um número nu, sem R$ nem %) e fecha a posição; as demais são as 6
// colunas de rentabilidade, sempre na mesma ordem no extrato do Itaú.
const PERIOD_KEYS = ["monthCurrent", "monthPrevious", "yearCurrent", "yearPrevious", "last12Months", "sinceInception"];
// O "R$" às vezes funde com o número no mesmo token ("R$ -400,27"), às vezes fica
// sozinho num token à parte (nesse caso é descartado como ruído, ver o loop principal)
// — o regex aceita os dois formatos; parseBrazilianAmount já ignora o "R$" ao converter.
const VALUE_TOKEN_RE = /^(?:R\$\s*)?-?\d{1,3}(\.\d{3})*,\d{2}$/;
const PERCENT_TOKEN_RE = /^-?\d+(,\d+)?%$/;

const DETAIL_HEADER_WORDS = new Set([
  "produto", "nome", "sua", "rentabilidade", "acumulada", "valor", "investido", "(r$)",
  "mês", "mes", "atual", "anterior", "ano", "últimos", "ultimos", "meses", "desde", "o",
  "início", "inicio", "12",
]);

function isBoilerplateWord(rawStr) {
  const clean = rawStr.toLowerCase().replace(/[().,:]/g, "").trim();
  if (!clean) return true;
  if (DETAIL_HEADER_WORDS.has(clean)) return true;
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\)?$/.test(rawStr)) return true; // "(atualizado 10/09/26)"
  return false;
}

// "CDB ANDBANKBM PRE 16% 28/12/2026" → 16
function extractContractedRatePct(name) {
  const m = name.match(/PRE\s*(\d+(?:[.,]\d+)?)\s*%/i);
  return m ? parseBrazilianAmount(m[1]) : null;
}

// "CDB ANDBANKBM PRE 16% 28/12/2026" → "2026-12-28"
function extractMaturity(name) {
  const m = name.match(/(\d{2}\/\d{2}\/\d{4})/);
  return m ? normalizeDateToISO(m[1]) : null;
}

function classFromProductName(name) {
  const n = name.toLowerCase();
  if (/tesouro/.test(n)) return "renda_fixa";
  if (/\bcdb\b/.test(n)) return "renda_fixa";
  if (/\([a-z]{2,5}\d{1,2}\)/i.test(name)) return "acoes"; // ticker entre parênteses, ex: (BBAS3)
  return "fundos";
}

function emptyReturns() {
  return PERIOD_KEYS.reduce((acc, key) => { acc[key] = { value: null, pct: null }; return acc; }, {});
}

function hasAnyReturn(returns) {
  return PERIOD_KEYS.some((key) => returns[key].value !== null || returns[key].pct !== null);
}

// Uma posição consolidada com várias classes de ativo tem uma tabela de produtos +
// resumo POR CATEGORIA (fundos, depois CDB/renda fixa, depois tesouro, ...), cada uma
// fechando com sua própria linha "total investido" — e cada categoria pode ter as
// colunas da tabela de produto num X levemente diferente das outras (é outra
// sub-tabela, não uma continuação da mesma). Por isso as colunas são descobertas
// separadamente dentro de cada seção, nunca no documento inteiro.
function splitIntoPortfolioSections(rows) {
  const lineOf = (row) => row.words.map((w) => w.str).join(" ");
  const sections = [];
  let start = 0;
  rows.forEach((row, i) => {
    if (TOTAL_RE.test(lineOf(row))) { sections.push(rows.slice(start, i + 1)); start = i + 1; }
  });
  return sections;
}

// Descobre as 7 colunas de dado (6 períodos de rentabilidade + valor investido) pela
// posição X das células numéricas — nunca pelo texto do cabeçalho, que quebra em
// linhas demais e repete palavras ("atual" aparece em "mês atual" e "ano atual"), e
// nunca incluindo "-", que também aparece como hífen dentro de nome de produto (ex:
// "FMP - FGTS") e contaminaria o agrupamento. Devolve `null` se não achar exatamente 7
// — layout fora do validado, melhor não arriscar dado errado.
function detectColumnCenters(region) {
  const xs = [];
  region.forEach((row) => row.words.forEach((w) => {
    if (VALUE_TOKEN_RE.test(w.str) || PERCENT_TOKEN_RE.test(w.str)) xs.push(w.x);
  }));
  xs.sort((a, b) => a - b);

  const clusters = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.max < 25) { last.max = x; last.xs.push(x); }
    else clusters.push({ max: x, xs: [x] });
  }
  if (clusters.length !== 7) return null;
  return clusters.map((c) => c.xs.reduce((s, v) => s + v, 0) / c.xs.length);
}

// O nome do produto quebra em várias linhas, e algumas dessas linhas de nome vêm
// DEPOIS da linha que fecha o valor investido (o rótulo continua descendo enquanto os
// números da posição já fecharam) — por isso a posição não pode ser fechada no
// instante em que o valor investido aparece. O sinal confiável de troca de produto é
// outro: o espaçamento vertical entre linhas de um MESMO produto é o espaçamento de
// linha normal do documento; entre um produto e o próximo, o vão é bem maior (quase
// o dobro) porque há um respiro visual na tabela. `computeBoundaryGap` mede o vão
// típico de linha na própria seção (mediana) e usa uma folga sobre ele para não
// depender de um número mágico fixo, que mudaria se o Itaú alterar o tamanho da fonte.
function computeBoundaryGap(region) {
  const gaps = [];
  for (let i = 1; i < region.length; i++) gaps.push(region[i - 1].y - region[i].y);
  if (gaps.length === 0) return Infinity;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.max(median * 1.8, median + 4);
}

// Extrai as posições de uma única seção, já com as colunas descobertas.
function extractSectionPositions(region, centers) {
  const boundaries = centers.slice(0, -1).map((c, i) => (c + centers[i + 1]) / 2);
  const VALOR_BAND = centers.length - 1;
  const bandIndex = (x) => {
    const i = boundaries.findIndex((b) => x < b);
    return i === -1 ? VALOR_BAND : i;
  };
  const boundaryGap = computeBoundaryGap(region);

  const investments = [];
  let nameParts = [];
  let returns = emptyReturns();
  let currentValue = null;
  let previousY = null;

  const finalize = () => {
    const name = nameParts.join(" ").replace(/\s{2,}/g, " ").trim();
    if (name && currentValue > 0) {
      investments.push({
        name,
        class: classFromProductName(name),
        currentValue,
        maturity: extractMaturity(name),
        contractedRatePct: extractContractedRatePct(name),
        returns: hasAnyReturn(returns) ? returns : null,
      });
    }
    nameParts = [];
    returns = emptyReturns();
    currentValue = null;
  };

  for (const row of region) {
    if (previousY !== null && previousY - row.y > boundaryGap) finalize();
    previousY = row.y;

    for (const w of row.words) {
      const str = w.str.trim();
      if (!str || /^R\$$/i.test(str)) continue; // o "R$" sozinho não carrega valor, é só rótulo

      const isDash = str === "-";
      const isValue = VALUE_TOKEN_RE.test(str);
      const isPercent = PERCENT_TOKEN_RE.test(str);

      if (isDash || isValue || isPercent) {
        const band = bandIndex(w.x);
        if (band === VALOR_BAND) {
          if (isValue) currentValue = parseBrazilianAmount(str);
          continue;
        }
        if (isValue) returns[PERIOD_KEYS[band]].value = parseBrazilianAmount(str);
        else if (isPercent) returns[PERIOD_KEYS[band]].pct = parseBrazilianAmount(str);
        continue;
      }

      // um "-" que sobrou (ex: hífen dentro do nome do produto) sem cair em nenhuma
      // banda de dado é só texto — cai aqui embaixo e cola no nome, como qualquer palavra.
      if (isBoilerplateWord(str)) continue;
      if (w.x < boundaries[0]) nameParts.push(str);
    }
  }
  finalize();

  return investments;
}

// `rows` no formato de groupIntoRows: [{ y, words: [{x, str}] }], já em ordem de leitura.
// Devolve `reliable: false` quando nenhuma seção tem o formato esperado — quem chama
// deve então cair pro resumo por classe (parsePortfolioLines), que é sempre confiável.
export function parsePortfolioDetail(rows) {
  const lineOf = (row) => row.words.map((w) => w.str).join(" ");
  const sections = splitIntoPortfolioSections(rows);

  const investments = [];
  let anySectionReliable = false;

  for (const section of sections) {
    const prodIdx = section.findIndex((r) => /\bproduto\b/i.test(lineOf(r)));
    if (prodIdx < 0) continue;

    const region = section.slice(prodIdx).filter((row) => {
      const line = lineOf(row);
      return !SUMMARY_ROW_RE.test(line) && !/tipo\s+de\s+investimento/i.test(line) && !TOTAL_RE.test(line);
    });

    const centers = detectColumnCenters(region);
    if (!centers) continue;

    investments.push(...extractSectionPositions(region, centers));
    anySectionReliable = true;
  }

  return { investments, reliable: anySectionReliable };
}

// Agrupa os "items" de texto posicionado do pdf.js (getTextContent) em linhas visuais,
// por proximidade de coordenada Y, e dentro de cada linha funde glifos/fragmentos em
// palavras (usando o vão horizontal real entre eles). Sem isso, um PDF que devolve um
// item por glifo ("P o s i ç ã o") ficaria ilegível — e alguns números saem fatiados
// mesmo em fontes normais (ex: "1" separado de "1.986,35"), daí o merge ser um pouco
// mais tolerante quando os dois fragmentos são puramente numéricos.
function isNumericFragment(s) {
  return /^-?[\d.,]+$/.test(s);
}

function groupIntoRows(items, yTolerance = 2) {
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

  return lines.map((line) => {
    const parts = line.parts.sort((a, b) => a.x - b.x);
    const words = [];
    let currentWord = null;
    let previousEnd = null;
    for (const part of parts) {
      const gap = previousEnd === null ? Infinity : part.x - previousEnd;
      const numericPair = currentWord && isNumericFragment(currentWord.str) && isNumericFragment(part.str);
      const threshold = numericPair ? Math.max(6, part.height * 0.3) : Math.max(1, part.height * 0.25);
      if (currentWord && gap <= threshold) {
        currentWord.str += part.str;
      } else {
        currentWord = { x: part.x, str: part.str };
        words.push(currentWord);
      }
      previousEnd = part.x + part.width;
    }
    return { y: line.y, words };
  });
}

function rowToLine(row) {
  return row.words.map((w) => w.str).join(" ").replace(/\s{2,}/g, " ").trim();
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

// Extrai as linhas de texto (uma string por linha visual) e as linhas com posição X
// preservada por palavra (pra reconstrução de tabela), na ordem das páginas.
export async function extractRows(arrayBuffer) {
  const pdfjsLib = await loadPdfjs();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allRows = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    allRows.push(...groupIntoRows(content.items));
  }
  return allRows;
}

export async function extractLines(arrayBuffer) {
  const rows = await extractRows(arrayBuffer);
  return rows.map(rowToLine);
}

// Um PDF do banco pode ser um extrato (lançamentos) ou a posição consolidada da
// carteira. Decide pelo conteúdo e devolve sempre a mesma forma.
export async function parsePdf(arrayBuffer, defaultAccount = "Importado (PDF)") {
  const rows = await extractRows(arrayBuffer);
  const lines = rows.map(rowToLine);

  if (looksLikePortfolioStatement(lines)) {
    const { investments: byClass, warnings, statedTotal } = parsePortfolioLines(lines);
    const detail = parsePortfolioDetail(rows);
    const detailTotal = detail.investments.reduce((s, i) => s + i.currentValue, 0);
    const byClassTotal = statedTotal !== null ? statedTotal : byClass.reduce((s, i) => s + i.currentValue, 0);
    const detailReconciles = detail.reliable && detail.investments.length > 0
      && Math.abs(detailTotal - byClassTotal) < 0.5;
    console.log("[DEBUG parsePdf]", JSON.stringify({
      reliable: detail.reliable, numDetail: detail.investments.length, detailTotal, byClassTotal, detailReconciles,
      names: detail.investments.map((i) => i.name),
    }));
    return { transactions: [], investments: detailReconciles ? detail.investments : byClass, warnings };
  }
  const { transactions, warnings } = parseStatementLines(lines, defaultAccount);
  return { transactions, investments: [], warnings };
}
