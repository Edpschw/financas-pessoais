// Detecta lançamentos de compra/resgate de ativos de investimento vindos do extrato
// bancário (ex: "COR ITAUCOR COMPRA TD", "RESGATE FUNDO X") — é dinheiro saindo da
// conta corrente pra dentro de um investimento (ou voltando de lá), não uma despesa
// ou receita de verdade. Sem isso, uma aplicação grande de uma vez distorce a Análise
// Mensal e pode até aparecer como "custo recorrente".
//
// Importante: proventos/rendimentos creditados (ex: "REND PAGO APLIC AUT MAIS", "COR
// JSCP PETR3") são receita de verdade — o dinheiro entrou de fato — por isso NÃO
// entram aqui; só o movimento de principal (comprar/resgatar o ativo em si).
const INVESTMENT_KEYWORDS = [
  "compra td", "compra de td", "compra tesouro", "compra de tesouro",
  "compra de titulo", "compra titulo", "compra de acao", "compra de acoes",
  "compra de cota", "compra de cotas", "compra de fundo",
  "itaucor compra", "itaucor resgate", "itaucor aplicacao",
  "resgate td", "resgate tesouro", "resgate de titulo", "resgate titulo",
  "resgate de fundo", "resgate fundo", "resgate de cota", "resgate de aplicacao",
  "aplicacao cdb", "compra cdb", "resgate cdb",
];

// Faixa Unicode das marcas de acento combinantes (0x0300-0x036f), construída por
// código de caractere em vez de escrita literal no código-fonte — mais seguro contra
// corrupção por editor/encoding do que colar os caracteres combinantes de verdade.
const DIACRITICS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

function normalize(desc) {
  return (desc || "").toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "");
}

export function isInvestmentMovement(description) {
  const text = normalize(description);
  return INVESTMENT_KEYWORDS.some((kw) => text.includes(kw));
}

// Categoria usada pra marcar (não apagar) esses lançamentos — continuam visíveis nas
// abas Transações/Dados, só ficam de fora das somas de receita/despesa das análises.
export const INVESTMENT_CATEGORY = "Investimentos";

export function isAnalyzableTransaction(t) {
  return t.category !== INVESTMENT_CATEGORY;
}
