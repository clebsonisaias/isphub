/*
 * Service worker do PWA do técnico (ISPhub).
 *
 * VERSAO, API e PRECACHE são preenchidos no build por scripts/gerar-sw.mjs:
 * cada build com conteúdo novo gera um sw.js diferente, e é isso que faz o
 * navegador oferecer a atualização (faixa "Nova versão" do index.html).
 *
 * - shell (index, JS, fontes, ícones): pré-carregado — o app abre sem sinal;
 * - API (só os GETs de API_OFFLINE): rede primeiro, cópia de reserva — sem
 *   sinal o app mostra o último que carregou. Login e logout apagam a cópia,
 *   porque o aparelho pode trocar de técnico.
 */
const VERSAO = "__VERSAO__";
const API = "__API__";
const PRECACHE = [] /* __PRECACHE__ */;

const SHELL = `shell-${VERSAO}`;
const DADOS = "api";

// Só leitura que o técnico precisa ver sem sinal. Fora: /eventos (stream SSE),
// foto (/arquivo) e as sondas ao vivo de conexão — cópia velha ali engana.
const API_OFFLINE = ["/auth/me", "/config", "/fila", "/ordens-servico/", "/dashboard/meu-dia", "/jornada/", "/frota/minha-viatura"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
});

// A versão nova espera o "Atualizar": trocar o JS no meio de um encerramento
// de OS perderia o que a pessoa estava digitando.
self.addEventListener("message", (event) => {
  if (event.data === "pular-espera") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith("shell-") && n !== SHELL).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function daApiOffline(url) {
  return url.origin === API && !url.pathname.endsWith("/arquivo") && API_OFFLINE.some((p) => url.pathname.startsWith(p));
}

async function redePrimeiro(request) {
  const cache = await caches.open(DADOS);
  try {
    const resposta = await fetch(request);
    if (resposta.ok) await cache.put(request, resposta.clone());
    return resposta;
  } catch (erro) {
    const copia = await cache.match(request);
    if (copia) return copia;
    throw erro;
  }
}

// SPA: toda rota é o mesmo index.html. Sem rede, o guardado.
async function navegacao(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match("/", { cacheName: SHELL })) || Response.error();
  }
}

async function shellPrimeiro(request) {
  const copia = await caches.match(request, { cacheName: SHELL });
  if (copia) return copia;
  const resposta = await fetch(request);
  if (resposta.ok) await (await caches.open(SHELL)).put(request, resposta.clone());
  return resposta;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    if (url.origin === API && (url.pathname === "/auth/login" || url.pathname === "/auth/logout")) {
      event.waitUntil(caches.delete(DADOS));
    }
    return;
  }
  if (request.mode === "navigate") return event.respondWith(navegacao(request));
  if (url.origin === self.location.origin) return event.respondWith(shellPrimeiro(request));
  if (daApiOffline(url)) return event.respondWith(redePrimeiro(request));
});
