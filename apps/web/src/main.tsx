import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import "./lib/gsapSetup"; // registra plugins GSAP antes de qualquer componente montar
import App from "./App.tsx";
import { emApp, ligarModoApp } from "./lib/modoApp";

// Cache de leitura compartilhado entre telas: voltar do detalhe pra fila
// mostra a lista na hora e re-busca por tras. Sem refetch no foco da janela
// — a Fila ja faz isso com debounce proprio, e as outras telas nao precisam.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// Dentro do app ISPhub (WebView): links de fora abrem no celular, e sem service worker.
if (emApp()) ligarModoApp();

// Registra o Service Worker do PWA para suporte offline e abertura instantânea.
// Nao no app: la ele so serviria para entregar uma versao velha do painel.
if (typeof window !== "undefined" && "serviceWorker" in navigator && !window.location.host.includes("localhost") && !emApp()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => {
        console.warn("[PWA] Falha ao registrar Service Worker:", err);
      });
  });
}
