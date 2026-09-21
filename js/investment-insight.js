// Previsão de valor futuro e avaliação de atratividade por investimento. Puro (sem
// DOM, sem rede) — a busca de Selic/CDI mora em rates.js; aqui só se recebe o
// benchmark já pronto (ou null, se offline) e se decide o critério com o que tiver.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAST_PERFORMANCE_DISCLAIMER = "Rentabilidade passada não garante rentabilidade futura.";

function yearsBetween(fromIso, toIso) {
  return (new Date(toIso) - new Date(fromIso)) / (MS_PER_DAY * 365.25);
}

// Renda fixa com taxa e vencimento conhecidos: projeta por juros compostos até o
// vencimento. Sem esses dados, usa o retorno dos últimos 12 meses (quando existir)
// projetado a 1/3/5 anos — sempre com o aviso de que retorno passado não é garantia.
// Sem nenhum dos dois, devolve `null` em vez de inventar um número.
export function computeForecast(investment, today = new Date().toISOString().slice(0, 10)) {
  const { currentValue, maturity, contractedRatePct } = investment;

  if (typeof contractedRatePct === "number" && maturity && maturity > today) {
    const years = yearsBetween(today, maturity);
    const projected = currentValue * Math.pow(1 + contractedRatePct / 100, years);
    return {
      basis: "taxa_contratada",
      maturity,
      projectedValue: projected,
      disclaimer: `Projeção pela taxa contratada (${contractedRatePct}% a.a.) até o vencimento em ${maturity}.`,
    };
  }

  const last12mPct = investment.returns?.last12Months?.pct;
  if (typeof last12mPct === "number") {
    const rate = last12mPct / 100;
    return {
      basis: "retorno_12m",
      horizons: [1, 3, 5].map((y) => ({ years: y, projectedValue: currentValue * Math.pow(1 + rate, y) })),
      disclaimer: `Projeção assumindo que o retorno dos últimos 12 meses (${last12mPct}%) se repete. ${PAST_PERFORMANCE_DISCLAIMER}`,
    };
  }

  return null;
}

const CONCENTRATION_THRESHOLD_PCT = 25;

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function levelFromComparison(diffPct) {
  if (diffPct >= 1) return "atrativo";
  if (diffPct <= -1) return "atencao";
  return "neutro";
}

// { level: 'atrativo'|'neutro'|'atencao', reasons: string[] }. Nunca só um selo sem
// motivo — é dinheiro de verdade, a pessoa precisa poder discordar do critério.
export function computeAttractiveness(investment, { allInvestments = [], totalPortfolio = 0, benchmark = null } = {}) {
  const reasons = [];
  let level = "neutro";

  const isFixedIncomeRate = typeof investment.contractedRatePct === "number";
  const last12mPct = investment.returns?.last12Months?.pct;

  if (benchmark) {
    if (isFixedIncomeRate && typeof benchmark.selicPct === "number") {
      const diff = investment.contractedRatePct - benchmark.selicPct;
      level = levelFromComparison(diff);
      reasons.push(
        `Taxa contratada de ${investment.contractedRatePct}% a.a. contra a Selic atual de ${benchmark.selicPct}% a.a.` +
        (diff >= 1 ? " — acima da Selic." : diff <= -1 ? " — abaixo da Selic." : " — próxima da Selic.")
      );
    } else if (typeof last12mPct === "number" && typeof benchmark.cdiPct === "number") {
      const diff = last12mPct - benchmark.cdiPct;
      level = levelFromComparison(diff);
      reasons.push(
        `Retorno de ${last12mPct}% nos últimos 12 meses contra o CDI de ${benchmark.cdiPct}% a.a.` +
        (diff >= 1 ? " — acima do CDI." : diff <= -1 ? " — abaixo do CDI." : " — próximo do CDI.")
      );
    } else {
      reasons.push("Sem dado de retorno suficiente para comparar com Selic/CDI.");
    }
  } else {
    const peers = allInvestments
      .filter((i) => i.name !== investment.name)
      .map((i) => i.returns?.last12Months?.pct)
      .filter((v) => typeof v === "number");
    const med = median(peers);
    if (typeof last12mPct === "number" && med !== null) {
      const diff = last12mPct - med;
      level = levelFromComparison(diff);
      reasons.push(
        `Sem conexão com a Selic/CDI: retorno de ${last12mPct}% comparado com a mediana da própria carteira (${med.toFixed(2)}%).`
      );
    } else {
      reasons.push("Sem conexão e sem dado de retorno suficiente para comparar com a carteira.");
    }
  }

  if (totalPortfolio > 0) {
    const sharePct = (investment.currentValue / totalPortfolio) * 100;
    if (sharePct > CONCENTRATION_THRESHOLD_PCT) {
      level = "atencao";
      reasons.push(`Concentra ${sharePct.toFixed(1)}% da carteira — acima do limite de ${CONCENTRATION_THRESHOLD_PCT}% recomendado para um único ativo.`);
    }
  }

  return { level, reasons };
}
