/*
 * Service worker do PWA do ISPhub / Técnico NetGO
 * Garante abertura instantânea mesmo sem sinal (offline shell)
 * e integração com o SyncEngine em IndexedDB.
 */
const VERSAO = "isphub-pwa-v2";
const CACHE_SHELL = `shell-${VERSAO}`;

const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons.svg",
  "/tema.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes
            .filter((n) => n.startsWith("shell-") && n !== CACHE_SHELL)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "pular-espera" || event.data?.tipo === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// SPA: navegações usam rede primeiro; se offline, abre o index.html em cache
async function tratarNavegacao(request) {
  try {
    const resposta = await fetch(request);
    if (resposta.ok) {
      const cache = await caches.open(CACHE_SHELL);
      cache.put("/", resposta.clone()).catch(() => {});
    }
    return resposta;
  } catch {
    const copia = await caches.match("/", { cacheName: CACHE_SHELL });
    if (copia) return copia;
    return (await caches.match(request)) || Response.error();
  }
}

// Arquivos estáticos da mesma origem (/assets/*, fontes, icones): cache com revalidação
async function tratarEstatico(request) {
  const cache = await caches.open(CACHE_SHELL);
  const copia = await cache.match(request);
  if (copia) {
    // Busca em segundo plano para atualizar o cache
    fetch(request)
      .then((res) => {
        if (res.ok) cache.put(request, res);
      })
      .catch(() => {});
    return copia;
  }

  try {
    const res = await fetch(request);
    if (res.ok) {
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    return copia || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Não intercepta chamadas que não sejam GET
  if (request.method !== "GET") return;

  // Não intercepta requisições SSE ou APIs externas
  if (url.pathname.startsWith("/eventos") || url.pathname.includes("/realtime")) return;

  // Navegação de página (SPA)
  if (request.mode === "navigate") {
    return event.respondWith(tratarNavegacao(request));
  }

  // Assets da própria origem
  if (url.origin === self.location.origin) {
    return event.respondWith(tratarEstatico(request));
  }
});
