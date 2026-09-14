function detectDelimiter(firstLine) {
  const counts = { ",": (firstLine.match(/,/g) || []).length, ";": (firstLine.match(/;/g) || []).length };
  return counts[";"] > counts[","] ? ";" : ",";
}

function parseCsvLine(line, delimiter) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

export function parseCSV(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter);
  const rows = lines.slice(1).map((l) => parseCsvLine(l, delimiter));
  return { headers, rows };
}

function guessColumn(headers, keywords) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const kw of keywords) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function guessMapping(headers) {
  return {
    date: guessColumn(headers, ["data", "date"]),
    description: guessColumn(headers, ["descri", "histor", "memo", "description", "detalhe", "lanç", "lanc"]),
    amount: guessColumn(headers, ["valor", "amount", "value"]),
    type: guessColumn(headers, ["tipo", "type"]),
    category: guessColumn(headers, ["categ"]),
    account: guessColumn(headers, ["conta", "account"]),
  };
}

const EXPENSE_TYPE_WORDS = ["expense", "despesa", "debito", "débito", "saida", "saída", "d"];
const INCOME_TYPE_WORDS = ["income", "receita", "credito", "crédito", "entrada", "c"];

function normalizeType(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (EXPENSE_TYPE_WORDS.includes(s)) return "expense";
  if (INCOME_TYPE_WORDS.includes(s)) return "income";
  return null;
}

// Exportada para reaproveitar em outros formatos de importação (Excel, PDF) que também
// trazem valores em formato brasileiro (1.234,56).
// Aceita tanto o formato brasileiro (1.234,56) quanto o americano (1,234.56): planilhas
// exportadas pelo banco às vezes saem em um, às vezes no outro. A regra é simples — o
// separador que aparece por último é o decimal; o outro é separador de milhar.
export function parseBrazilianAmount(raw) {
  if (raw === undefined || raw === null) return NaN;
  const s = String(raw).replace(/[^\d,.-]/g, "");
  if (!s) return NaN;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const digitsOnly = s.replace("-", "");

  let normalized = s;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = s.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // vírgula sozinha é decimal, exceto quando é claramente milhar (1,234 / 1,234,567)
    normalized = /^\d{1,3}(,\d{3})+$/.test(digitsOnly) ? s.split(",").join("") : s.replace(",", ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(digitsOnly)) {
    normalized = s.split(".").join("");
  }
  return parseFloat(normalized);
}

// DD/MM/YYYY (ou YY) -> YYYY-MM-DD. Retorna a string original se não bater o padrão BR
// (ex: já está em YYYY-MM-DD, formato usado por CSVs no padrão ISO).
export function normalizeDateToISO(rawDate) {
  const date = (rawDate || "").trim();
  const brDate = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!brDate) return date;
  let [, d, m, y] = brDate;
  if (y.length === 2) y = "20" + y;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function rowsToTransactions(rows, mapping, defaultCategory = "Outros", defaultAccount = "Importado (CSV)") {
  const out = [];
  for (const row of rows) {
    const rawDate = row[mapping.date];
    const description = row[mapping.description] || "Transação importada";
    const rawAmount = row[mapping.amount];
    const amount = parseBrazilianAmount(rawAmount);
    if (!rawDate || Number.isNaN(amount) || amount === 0) continue;

    const date = normalizeDateToISO(rawDate);

    const rawType = mapping.type >= 0 ? row[mapping.type] : null;
    const type = normalizeType(rawType) || (amount < 0 ? "expense" : "income");
    const rawCategory = mapping.category >= 0 ? (row[mapping.category] || "").trim() : "";
    const rawAccount = mapping.account >= 0 ? (row[mapping.account] || "").trim() : "";

    out.push({
      date,
      description,
      amount: Math.abs(amount),
      type,
      category: rawCategory || defaultCategory,
      account: rawAccount || defaultAccount,
    });
  }
  return out;
}
