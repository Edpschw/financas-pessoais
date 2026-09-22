// Categoria aproximada de um lançamento sem categoria de verdade, inferida pelo nome
// do comerciante/contraparte. Dois usos: todo item de fatura de cartão (o arquivo não
// traz categoria por item, só o nome — ex: "Zona Sul Fl 23", "Netflix.com") e, no
// extrato, qualquer lançamento que caiu em "Outros" (PIX/TED/boleto não vêm
// categorizados do banco, só salário/freelance vêm prontos). É heurística por
// palavra-chave, no mesmo estilo de isInvestmentMovement (js/investment-flow.js): não
// é perfeita, e o que não bate com nada continua "Outros" em vez de arriscar um chute
// errado.
//
// Palavras-chave escolhidas com cuidado pra não colidir entre si — ex: "supermercado"
// por extenso em vez de "mercado" sozinho, que pegaria "Mercado*Mercadolivre" (uma
// compra no marketplace, não uma ida ao mercado); "azul linhas aéreas" por extenso em
// vez de só "azul", que pegaria "Azul Seguros" (seguradora, não companhia aérea).
const CATEGORY_KEYWORDS = [
  ["Alimentação", [
    "restaurante", "bar ", "boteco", "churrasc", "pizzaria", "sushi", "hamburgu",
    "padaria", "acai", "sorvete", "cafe", "lanchonete", "ifd*", "zona sul",
    "pao de acucar", "supermercado", "hortifruti", "emporio", "quiosque",
  ]],
  ["Transporte", [
    "metro ", "uber", "99app", "99 app", "posto ", "combustivel", "estacionamento",
    "pedagio", "taxi",
  ]],
  ["Assinaturas", [
    "netflix", "disney", "spotify", "amazon prime", "hbo", "youtube premium",
    "anthropic", "claude", "globoplay", "deezer", "google one", "icloud",
  ]],
  ["Saúde", [
    "drogaria", "farmacia", "clinica", "laboratorio", "hospital", "odonto",
    "academia", "smartfit",
  ]],
  ["Compras", [
    "mercadolivre", "shopee", "amazon.com.br", "shein", "aliexpress",
    "magazine luiza", "lojas americanas", "renner", "leroy merlin",
  ]],
  ["Lazer", [
    "cinema", "ingresso", "eventos", "parque", "teatro",
  ]],
  ["Viagem", [
    "hotel", "booking", "airbnb", "latam", "gol linhas", "azul linhas aereas",
    "decolar", "cvc ",
  ]],
  // Prefixo, não a palavra inteira: a exportação do Itaú trunca descrição longa (ex:
  // "PAG BOLETO PLATACOR CORRETAGEM DE SEGUR" — corta bem no meio de "SEGURADORA").
  // "segur" cobre seguro/seguros/segurado/seguradora e a forma truncada, sem colidir
  // com nada comum em nome de comerciante.
  ["Seguros", [
    "segur",
  ]],
  // "Conta Global" é o produto multi-moeda do Itaú; IOF sobre ela é o imposto
  // específico de câmbio — as duas juntas só aparecem em movimentação internacional.
  ["Transferência internacional", [
    "conta global",
  ]],
];

// Faixa Unicode das marcas de acento combinantes, construída por código de caractere
// (não escrita literal) — mais seguro contra corrupção de editor/encoding.
const DIACRITICS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

function normalize(desc) {
  return (desc || "").toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "");
}

export function inferCategory(description) {
  const text = normalize(description);
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) return category;
  }
  return "Outros";
}
