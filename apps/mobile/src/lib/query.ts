import { AppState, Platform } from "react-native";
import { focusManager, QueryClient } from "@tanstack/react-query";

/**
 * QueryClient — espinha dorsal de freshness. O SSE (lib/realtime) so acelera; a
 * correcao vem daqui: refetch ao voltar ao foco (AppState) e ao reconectar.
 * Depois de qualquer buraco de sinal, a frescura volta sozinha.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: 1,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});

// Liga o "window focus" do React Query ao ciclo de vida do app: voltar do
// background revalida a fila/detalhe. (No web o RQ ja usa o focus do browser.)
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");
  });
}
