import { useEffect } from "react";
import EventSource from "react-native-sse";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeEvento } from "@isphub/shared";
import { API_BASE } from "./api";
import { useAuth } from "./auth";

type ListenerDigitando = (conversaId: string, autorId: string) => void;
const listenersDigitando = new Set<ListenerDigitando>();

function emitirDigitando(conversaId: string, autorId: string): void {
  for (const listener of listenersDigitando) listener(conversaId, autorId);
}

/**
 * "Alguem digitando" e efemero e de alta frequencia (um evento por debounce
 * de tecla, de cada participante) — invalidar uma query do React Query pra
 * isso seria caro e piscaria a lista à toa. Por isso um bus minimo em
 * memoria, fora do cache do React Query, so pra quem esta com a thread
 * aberta na tela.
 */
export function useDigitando(conversaId: string, onDigitando: (autorId: string) => void): void {
  useEffect(() => {
    const listener: ListenerDigitando = (cId, autorId) => {
      if (cId === conversaId) onDigitando(autorId);
    };
    listenersDigitando.add(listener);
    return () => {
      listenersDigitando.delete(listener);
    };
  }, [conversaId, onDigitando]);
}

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
        case "chat-mensagem":
        case "chat-conversa":
          qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
          if (ev.conversaId) qc.invalidateQueries({ queryKey: ["chat", "mensagens", ev.conversaId] });
          break;
        case "chat-leitura":
          qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
          break;
        case "chat-digitando":
          if (ev.conversaId && ev.autorId) emitirDigitando(ev.conversaId, ev.autorId);
          break;
        case "cliente-chat-mensagem":
        case "cliente-chat-conversa":
          qc.invalidateQueries({ queryKey: ["cliente-chat", "conversas"] });
          if (ev.conversaId) qc.invalidateQueries({ queryKey: ["cliente-chat", "mensagens", ev.conversaId] });
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
