import { useEffect } from "react";
import EventSource from "react-native-sse";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeEvento } from "@isphub/shared";
import { API_BASE } from "./api";
import { useAuth } from "./auth";

/**
 * Cliente SSE — o "empurrao ao vivo" (ISPhub -> app). Best-effort: se cair, o
 * react-native-sse reconecta sozinho, e o React Query (foreground/reconnect)
 * cobre o intervalo. Nunca a correcao depende da conexao aberta. Escopado por
 * tecnico no servidor (/eventos usa o token).
 */
export function useRealtime(): void {
  const { token } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`${API_BASE}/eventos`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const onMessage = (event: { type: string; data?: string | null }) => {
      if (!event.data) return;
      let ev: RealtimeEvento;
      try {
        ev = JSON.parse(event.data) as RealtimeEvento;
      } catch {
        return;
      }
      switch (ev.tipo) {
        case "os-alterada":
          if (ev.osId) qc.invalidateQueries({ queryKey: ["os", ev.osId] });
          qc.invalidateQueries({ queryKey: ["fila"] });
          break;
        case "os-atribuida":
        case "os-removida":
          qc.invalidateQueries({ queryKey: ["fila"] });
          break;
        case "config-alterada":
          qc.invalidateQueries({ queryKey: ["config"] });
          break;
      }
    };

    es.addEventListener("message", onMessage);
    return () => {
      es.removeAllEventListeners();
      es.close();
    };
  }, [token, qc]);
}
