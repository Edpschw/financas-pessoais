// Selic e CDI atuais, via API pública do Banco Central (SGS) — a única chamada de
// rede do app, e só para comparar investimentos com o mercado (ver
// investment-insight.js). Sem chave, sem dado do usuário enviado, CORS liberado. Se
// falhar (offline, timeout, indisponível), devolve `null` sem lançar erro: quem chama
// cai no fallback offline (comparar com a própria carteira) em vez de travar a tela.
const SELIC_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json";
const CDI_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json";
const CACHE_KEY = "financas-pessoais:benchmark-rates";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 dia
const FETCH_TIMEOUT_MS = 4000;

function parseBcbNumber(str) {
  const n = parseFloat((str || "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function fetchSeries(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const last = Array.isArray(data) ? data[data.length - 1] : null;
    return last ? parseBcbNumber(last.valor) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage indisponível/cheio: sem cache, só refaz a busca na próxima vez.
  }
}

// { selicPct, cdiPct, fetchedAt } com as taxas anuais atuais, ou `null` se não deu pra
// buscar (offline) nem havia cache válido de até 1 dia atrás.
export async function fetchBenchmarkRates() {
  const cached = readCache();
  if (cached) return cached;

  const [selicPct, cdiPct] = await Promise.all([fetchSeries(SELIC_URL), fetchSeries(CDI_URL)]);
  if (selicPct === null && cdiPct === null) return null;

  const entry = { selicPct, cdiPct, fetchedAt: Date.now() };
  writeCache(entry);
  return entry;
}
