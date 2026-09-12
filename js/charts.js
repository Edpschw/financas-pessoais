const instances = {};

export function renderChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    console.warn("Chart.js não carregou (sem conexão com o CDN?) — gráficos ficarão indisponíveis.");
    return;
  }
  if (instances[canvasId]) instances[canvasId].destroy();
  instances[canvasId] = new Chart(canvas.getContext("2d"), config);
}

const PALETTE = ["#2f6fed", "#1b9e5a", "#c9871f", "#8a5fd1", "#d9433f", "#2fb0c0", "#7a8699"];

export function cashflowChart(canvasId, months, monthLabels, incomeSeries, expenseSeries) {
  renderChart(canvasId, {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: [
        { label: "Receitas", data: incomeSeries, backgroundColor: "#1b9e5a" },
        { label: "Despesas", data: expenseSeries, backgroundColor: "#d9433f" },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

export function allocationChart(canvasId, labels, values) {
  renderChart(canvasId, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE }] },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } },
  });
}

export function categoriesChart(canvasId, labels, values) {
  renderChart(canvasId, {
    type: "bar",
    data: { labels, datasets: [{ label: "Gasto", data: values, backgroundColor: "#2f6fed" }] },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } },
    },
  });
}

export function netWorthChart(canvasId, labels, values) {
  renderChart(canvasId, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Patrimônio investido",
        data: values,
        borderColor: "#2f6fed",
        backgroundColor: "rgba(47,111,237,0.12)",
        tension: 0.25,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

export function targetVsActualChart(canvasId, labels, actual, target) {
  renderChart(canvasId, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Atual (%)", data: actual, backgroundColor: "#2f6fed" },
        { label: "Referência do perfil (%)", data: target, backgroundColor: "#c9d3de" },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { beginAtZero: true, max: 100 } },
    },
  });
}
