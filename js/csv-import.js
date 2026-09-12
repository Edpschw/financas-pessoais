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
    description: guessColumn(headers, ["descri", "histor", "memo", "description", "detalhe"]),
    amount: guessColumn(headers, ["valor", "amount", "value"]),
  };
}

function parseBrazilianAmount(raw) {
  if (!raw) return NaN;
  let s = raw.replace(/[^\d,.-]/g, "");
  // se tem vírgula e ponto, assume ponto = milhar, vírgula = decimal (padrão BR)
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  return parseFloat(s);
}

export function rowsToTransactions(rows, mapping, defaultCategory = "Outros") {
  const out = [];
  for (const row of rows) {
    const rawDate = row[mapping.date];
    const description = row[mapping.description] || "Transação importada";
    const rawAmount = row[mapping.amount];
    const amount = parseBrazilianAmount(rawAmount);
    if (!rawDate || Number.isNaN(amount) || amount === 0) continue;

    let date = rawDate.trim();
    // normaliza DD/MM/YYYY -> YYYY-MM-DD
    const brDate = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (brDate) {
      let [, d, m, y] = brDate;
      if (y.length === 2) y = "20" + y;
      date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    out.push({
      date,
      description,
      amount: Math.abs(amount),
      type: amount < 0 ? "expense" : "income",
      category: defaultCategory,
      account: "Importado (CSV)",
    });
  }
  return out;
}
