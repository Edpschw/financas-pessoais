// Parser simples para extratos OFX/QFX (SGML "tag soup" comum em bancos brasileiros).
// Não depende de bibliotecas externas: extrai cada bloco <STMTTRN>...</STMTTRN> via regex.

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([^<\r\n]*)`, "i"));
  return match ? match[1].trim() : "";
}

function parseOfxDate(raw) {
  // formato OFX: YYYYMMDDHHMMSS[.xxx][:GMT...]
  const digits = (raw || "").replace(/[^0-9]/g, "").slice(0, 8);
  if (digits.length < 8) return null;
  const y = digits.slice(0, 4), m = digits.slice(4, 6), d = digits.slice(6, 8);
  return `${y}-${m}-${d}`;
}

export function parseOFX(text) {
  const blocks = text.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) || [];
  const transactions = [];

  for (const block of blocks) {
    const dateRaw = extractTag(block, "DTPOSTED");
    const amountRaw = extractTag(block, "TRNAMT");
    const name = extractTag(block, "NAME") || extractTag(block, "MEMO");
    const memo = extractTag(block, "MEMO");

    const date = parseOfxDate(dateRaw);
    const amount = parseFloat((amountRaw || "0").replace(",", "."));
    if (!date || Number.isNaN(amount) || amount === 0) continue;

    transactions.push({
      date,
      description: name || memo || "Transação importada",
      amount: Math.abs(amount),
      type: amount < 0 ? "expense" : "income",
      category: "Outros",
      account: "Importado (OFX)",
    });
  }

  return transactions;
}
