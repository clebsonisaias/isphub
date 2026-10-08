import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import "./lib/gsapSetup"; // registra plugins GSAP antes de qualquer componente montar
import App from "./App.tsx";

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
