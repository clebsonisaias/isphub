import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { RealtimeEvento } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { getAuthToken } from "./apiClient";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const BACKOFF_INICIAL_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

type Listener = (evento: RealtimeEvento) => void;

const RealtimeContext = createContext<
  { subscribe: (l: Listener) => () => void } | undefined
>(undefined);

/**
 * Primeiro cliente SSE do web. Nao da pra usar o EventSource nativo do
 * browser: ele nao manda header Authorization, e /eventos exige Bearer — e
 * colocar o token na query string vaza em log de proxy/historico. Por isso
 * fetch() + ReadableStream, lendo o stream "text/event-stream" na mao.
 *
 * Best-effort de ponta a ponta (mesmo espirito do realtimeHub no servidor):
 * reconecta com backoff exponencial (1s -> 30s, sem desistir), e se o stream
 * nunca conectar cada tela continua funcionando pelo proprio polling (sino de
 * notificacao, badge do chat) — o SSE so reduz a latencia, nunca e a unica
 * fonte de verdade.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const listenersRef = useRef(new Set<Listener>());

  useEffect(() => {
    if (!usuario) return;
    const token = getAuthToken();
    if (!token) return;

    const controller = new AbortController();
    let parado = false;
    let backoffMs = BACKOFF_INICIAL_MS;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function conectar() {
      try {
        const res = await fetch(`${API_URL}/eventos`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.ok || !res.body)
          throw new Error(`SSE respondeu ${res.status}`);

        backoffMs = BACKOFF_INICIAL_MS; // conectou -> reseta o backoff pra proxima queda

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!parado) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Eventos SSE sao separados por linha em branco; cada bloco tem "data: <json>".
          const blocos = buffer.split("\n\n");
          buffer = blocos.pop() ?? "";
          for (const bloco of blocos) {
            const linhaDados = bloco
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!linhaDados) continue; // comentario de keep-alive (":ping") ou vazio
            try {
              const evento = JSON.parse(
                linhaDados.slice("data: ".length),
              ) as RealtimeEvento;
              for (const listener of listenersRef.current) listener(evento);
            } catch {
              // linha malformada — ignora e segue lendo o stream
            }
          }
        }
      } catch {
        // conexao caiu (rede, proxy, servidor reiniciando) — reconecta abaixo com backoff
      }

      if (parado) return;
      timeoutId = setTimeout(() => void conectar(), backoffMs);
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    }

    void conectar();

    return () => {
      parado = true;
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [usuario]);

  function subscribe(listener: Listener) {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }

  return (
    <RealtimeContext.Provider value={{ subscribe }}>
      {children}
    </RealtimeContext.Provider>
  );
}

/** Assina eventos SSE — o callback pode mudar a cada render sem precisar memoizar. */
export function useRealtime(onEvento: Listener) {
  const ctx = useContext(RealtimeContext);
  if (!ctx)
    throw new Error("useRealtime deve ser usado dentro de <RealtimeProvider>");

  const onEventoRef = useRef(onEvento);
  onEventoRef.current = onEvento;

  useEffect(
    () => ctx.subscribe((evento) => onEventoRef.current(evento)),
    [ctx],
  );
}
