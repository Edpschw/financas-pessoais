const CACHE_NAME = "financas-pessoais-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./manifest.json",
  "./js/app.js",
  "./js/storage.js",
  "./js/utils.js",
  "./js/advisor.js",
  "./js/csv-import.js",
  "./js/ofx-import.js",
  "./js/categorize.js",
  "./js/charts.js",
  "./js/accounts.js",
  "./js/loans.js",
  "./js/recurring.js",
  "./js/quotes.js",
  "./js/auto-import.js",
  "./js/excel-import.js",
  "./js/pdf-import.js",
  "./js/json-import.js",
  "./js/recurring-analysis.js",
  "./js/investment-flow.js",
  "./js/vendor/chart.umd.js",
  "./js/vendor/xlsx.full.min.js",
  "./js/vendor/pdf.min.mjs",
  "./js/vendor/pdf.worker.min.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Stale-while-revalidate para os arquivos do próprio app: funciona offline depois
// da primeira visita e atualiza o cache em segundo plano quando há rede.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
