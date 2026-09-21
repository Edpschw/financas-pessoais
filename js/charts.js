// Gráficos (Chart.js vendorizado em js/vendor/). As cores saem dos tokens CSS, então
// os gráficos acompanham o tema claro/escuro sem duplicar a paleta aqui.
const instances = {};

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function baseOptions() {
  const ink = token("--ink-muted");
  const grid = token("--border");
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: { color: ink, usePointStyle: true, boxWidth: 8, padding: 16, font: { family: "Public Sans", size: 12 } },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: ink, font: { family: "IBM Plex Mono", size: 10.5 } } },
      y: { grid: { color: grid }, ticks: { color: ink, font: { family: "IBM Plex Mono", size: 10.5 } } },
    },
  };
}

function render(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    console.warn("Chart.js não carregou — gráficos ficarão indisponíveis.");
    return;
  }
  if (instances[canvasId]) instances[canvasId].destroy();
  instances[canvasId] = new Chart(canvas.getContext("2d"), config);
}

// Um canvas dentro de uma aba escondida nasce com tamanho zero. Ao trocar de aba,
// os gráficos daquela tela precisam ser remedidos — senão ficam invisíveis.
export function resizeCharts() {
  Object.values(instances).forEach((chart) => chart.resize());
}

const brl = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlShort = (v) => (Math.abs(v) >= 1000
  ? "R$ " + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "k"
  : brl(v));

export function cashflowChart(canvasId, labels, incomeSeries, expenseSeries) {
  const opts = baseOptions();
  render(canvasId, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Receita", data: incomeSeries, backgroundColor: token("--positive"), borderRadius: 3, maxBarThickness: 26 },
        { label: "Despesa", data: expenseSeries, backgroundColor: token("--negative"), borderRadius: 3, maxBarThickness: 26 },
      ],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${brl(c.parsed.y)}` } },
      },
      scales: {
        ...opts.scales,
        y: { ...opts.scales.y, beginAtZero: true, ticks: { ...opts.scales.y.ticks, callback: brlShort } },
      },
    },
  });
}

export function allocationChart(canvasId, labels, values) {
  const palette = [token("--accent"), token("--positive"), token("--negative"), token("--warning"), token("--ink-muted")];
  const opts = baseOptions();
  render(canvasId, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => palette[i % palette.length]),
        borderColor: token("--surface"),
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: opts.plugins.legend,
        tooltip: {
          callbacks: {
            label: (c) => {
              const total = c.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((c.parsed / total) * 100).toFixed(1) : "0.0";
              return `${c.label}: ${brl(c.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

// Série única em barras — proventos de investimento (padrão) e gasto mensal do
// cartão (`color: "--negative", label: "Gasto"`) reaproveitam a mesma função: a única
// diferença entre os dois é a cor e o rótulo do tooltip/legenda.
export function proceedsChart(canvasId, labels, values, { color = "--positive", label = "Proventos" } = {}) {
  const opts = baseOptions();
  render(canvasId, {
    type: "bar",
    data: { labels, datasets: [{ label, data: values, backgroundColor: token(color), borderRadius: 3, maxBarThickness: 22 }] },
    options: {
      ...opts,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => brl(c.parsed.y) } },
      },
      scales: {
        ...opts.scales,
        y: { ...opts.scales.y, beginAtZero: true, ticks: { ...opts.scales.y.ticks, callback: brlShort } },
      },
    },
  });
}
