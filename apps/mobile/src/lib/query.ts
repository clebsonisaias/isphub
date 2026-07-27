import { QueryClient } from "@tanstack/react-query";

/**
 * QueryClient — espinha dorsal de freshness (o realtime/SSE do incremento 4
 * so acelera; a correcao vem daqui). Refetch ao reconectar/voltar ao foco sera
 * ligado no incremento 4 (AppState + focusManager/onlineManager).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: 1,
      refetchOnReconnect: true,
    },
  },
});
