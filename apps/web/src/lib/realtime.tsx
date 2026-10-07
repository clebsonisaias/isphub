import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeEvento } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { api, getAuthToken } from "./apiClient";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const BACKOFF_INICIAL_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

type Listener = (evento: RealtimeEvento) => void;

const RealtimeContext = createContext<
  { subscribe: (l: Listener) => () => void; conectado: boolean | null } | undefined
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
  /*
   * Exposto porque um stream morto e INVISIVEL: a tela simplesmente para de
   * receber novidade e continua com cara de atualizada. A queixa "abri a OS no
   * SGP e nao apareceu, ja faz meia hora" tem essa forma exata.
   */
  /*
   * TRES estados, nao dois. `null` = ainda tentando a primeira conexao.
   *
   * Com booleano o valor inicial era `false`, e a tela piscava "sem atualizacao
   * automatica" em TODA carga de pagina, antes de o SSE sequer ter chance de
   * conectar. Alarme falso ensina a ignorar o alarme — e ainda mexia no layout
   * a cada load.
   */
  const [conectado, setConectado] = useState<boolean | null>(null);

  useEffect(() => {
    if (!usuario) return;
    if (!getAuthToken()) return;

    const controller = new AbortController();
    let parado = false;
    let backoffMs = BACKOFF_INICIAL_MS;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function conectar() {
      try {
        /*
         * Le o token A CADA tentativa. Antes ele era capturado uma vez na
         * abertura do efeito: quando a sessao renovava, o SSE seguia usando o
         * token velho e reconectava contra 401 em backoff pra sempre — um
         * stream morto que nunca voltava sozinho.
         */
        const token = getAuthToken();
        if (!token) throw new Error("sem token");

        const res = await fetch(`${API_URL}/eventos`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        // 401 aqui e access token vencido, nao queda de conexao: renovar e
        // reconectar na hora resolve, enquanto esperar o backoff so atrasa.
        if (res.status === 401) {
          const renovou = (await api.renovarSessao()) === "renovou";
          if (renovou && !parado) {
            void conectar();
            return;
          }
          /*
           * Renovacao recusada. NAO sai mais em silencio: a recusa pode ser
           * transitoria (blip de rede, 5xx no refresh) e a sessao continuar
           * viva — e nesse caso o stream morria pra sempre, deixando a tela
           * congelada ate alguem apertar F5.
           *
           * Cair no backoff comum resolve os dois casos: se a sessao morreu
           * mesmo, o AuthContext desmonta isto em segundos; se foi blip, a
           * proxima tentativa reconecta. O teto de 30s garante que "nao
           * martelar o servidor" continua valendo.
           */
          throw new Error("renovacao de sessao recusada");
        }

        if (!res.ok || !res.body)
          throw new Error(`SSE respondeu ${res.status}`);

        backoffMs = BACKOFF_INICIAL_MS; // conectou -> reseta o backoff pra proxima queda
        setConectado(true);

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

      setConectado(false);
      if (parado) return;
      timeoutId = setTimeout(() => void conectar(), backoffMs);
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    }

    void conectar();

    return () => {
      parado = true;
      setConectado(false);
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [usuario]);

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ subscribe, conectado }), [subscribe, conectado]);

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

/**
 * O stream esta de pe? `null` enquanto a primeira conexao nao resolveu — quem
 * mostra aviso deve tratar `null` como "ainda nao sei", nunca como "caiu".
 */
export function useRealtimeConectado(): boolean | null {
  return useContext(RealtimeContext)?.conectado ?? null;
}

/** Assina eventos SSE — o callback pode mudar a cada render sem precisar memoizar. */
export function useRealtime(onEvento: Listener) {
  const ctx = useContext(RealtimeContext);
  if (!ctx)
    throw new Error("useRealtime deve ser usado dentro de <RealtimeProvider>");

  const onEventoRef = useRef(onEvento);
  // Fora do render (regra no-ref-current-in-render). O callback so e lido dentro
  // do subscribe (eventos SSE, sempre assincronos), entao um effect basta.
  useEffect(() => {
    onEventoRef.current = onEvento;
  });

  useEffect(
    () => ctx.subscribe((evento) => onEventoRef.current(evento)),
    [ctx],
  );
}
