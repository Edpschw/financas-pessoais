// Busca de cotação 100% opcional e client-side, direto do navegador do usuário para
// APIs públicas de mercado — não é uma integração com banco/corretora (nenhuma conta
// é conectada, nenhuma credencial é usada), só uma consulta de preço público sob demanda.
// Falha graciosamente (retorna null) se não houver rede ou o serviço estiver fora do ar.

export async function fetchStockQuote(ticker) {
  try {
    const res = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(ticker.toUpperCase())}`);
    if (!res.ok) return null;
    const data = await res.json();
    const price = data && data.results && data.results[0] && data.results[0].regularMarketPrice;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

export async function fetchCryptoQuote(coinId) {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=brl`);
    if (!res.ok) return null;
    const data = await res.json();
    const price = data && data[coinId] && data[coinId].brl;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}
