// Cache do PWA. O nome da versão precisa mudar sempre que a lista de arquivos mudar:
// o handler de activate apaga os caches de versões anteriores, evitando que o
// navegador continue servindo uma versão antiga do app.
const CACHE_NAME = "financas-pessoais-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./css/fonts.css",
  "./manifest.json",
  "./js/app.js",
  "./js/storage.js",
  "./js/utils.js",
  "./js/charts.js",
  "./js/auto-import.js",
  "./js/csv-import.js",
  "./js/ofx-import.js",
  "./js/excel-import.js",
  "./js/pdf-import.js",
  "./js/json-import.js",
  "./js/investment-flow.js",
  "./js/vendor/chart.umd.js",
  "./js/vendor/xlsx.full.min.js",
  "./js/vendor/pdf.min.mjs",
  "./js/vendor/pdf.worker.min.mjs",
  // As fontes também entram no shell: elas são servidas daqui, não do Google, e sem
  // elas no cache a primeira visita offline cairia na fonte de fallback.
  "./fonts/public-sans-latin.woff2",
  "./fonts/public-sans-latin-ext.woff2",
  "./fonts/sora-latin.woff2",
  "./fonts/sora-latin-ext.woff2",
  "./fonts/ibm-plex-mono-400-latin.woff2",
  "./fonts/ibm-plex-mono-400-latin-ext.woff2",
  "./fonts/ibm-plex-mono-500-latin.woff2",
  "./fonts/ibm-plex-mono-500-latin-ext.woff2",
  "./fonts/ibm-plex-mono-600-latin.woff2",
  "./fonts/ibm-plex-mono-600-latin-ext.woff2",
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

// Network-first para os arquivos do próprio app: com rede, sempre pega a versão atual
// (evita ficar preso numa versão antiga depois de uma atualização); sem rede, cai no
// cache e o app continua funcionando offline.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
