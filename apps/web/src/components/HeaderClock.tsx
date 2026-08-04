import { useEffect, useRef, useState } from "react";
import { gsap, useGSAP } from "@/lib/gsapSetup";
import { horaApi } from "@/lib/horaApi";
import { Clock3 } from "lucide-react";

const RESYNC_MS = 5 * 60_000;
const TIMEZONE_FALLBACK = "America/Fortaleza";
const CIDADE_FALLBACK = "Natal, RN";

const fmtHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIMEZONE_FALLBACK,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const fmtData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIMEZONE_FALLBACK,
  weekday: "short",
  day: "2-digit",
  month: "short",
});

/**
 * Relogio do cabecalho: hora/data de Natal/RN (sede da empresa), sincronizado
 * com a hora de rede via GET /hora (nao confia no relogio do dispositivo do
 * usuario). Sincroniza a cada 5min e faz tick local a cada segundo entre
 * sincronizacoes, pra nao bater na API a cada frame.
 */
export function HeaderClock() {
  const [agora, setAgora] = useState<Date>(() => new Date());
  const [cidade, setCidade] = useState(CIDADE_FALLBACK);
  const offsetRef = useRef(0); // isoUtc(rede) - Date.now(local) no momento da sincronizacao
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!rootRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(rootRef.current, { opacity: 1 });
      return;
    }
    // fromTo (nao `from`): o elemento ja nasce com a classe `opacity-0` do
    // Tailwind — `from()` leria esse 0 computado como o "destino" implicito
    // e o fade nunca apareceria. Os dois extremos explicitos evitam a ambiguidade.
    gsap.fromTo(rootRef.current, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.4, ease: "power1.out" });
  }, []);

  useEffect(() => {
    let cancelado = false;

    async function sincronizar() {
      try {
        const { isoUtc, cidade: cidadeResp } = await horaApi.obter();
        if (cancelado) return;
        offsetRef.current = Date.parse(isoUtc) - Date.now();
        setCidade(cidadeResp);
      } catch {
        // Sem rede: mantem o offset anterior (ou 0, ou seja, cai pro relogio local do navegador).
      }
    }

    void sincronizar();
    const resync = setInterval(sincronizar, RESYNC_MS);
    const tick = setInterval(() => setAgora(new Date(Date.now() + offsetRef.current)), 1000);
    return () => {
      cancelado = true;
      clearInterval(resync);
      clearInterval(tick);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      /*
       * SAIU DA LINHA DO CABECALHO (era `2xl:flex` ali) e vive agora dentro do
       * menu do usuario.
       *
       * Na linha, ele tinha uma inversao embutida: o breakpoint olhava a
       * JANELA, mas o espaco disponivel e o CONTAINER, travado em `max-w-7xl`.
       * Aumentar a tela nunca dava mais espaco a barra — so disparava o
       * relogio em 1536px, que tomava 291px e empurrava 275px de itens de
       * navegacao pra fora, com a barra de rolagem escondida (`scrollbar-none`)
       * mascarando a perda. Resultado medido: quanto MAIOR a tela, menos menu.
       *
       * Aqui ele fica sempre visivel (nao so acima de 1536px), cabe inteiro
       * com a cidade, e nao disputa espaco com a navegacao — que era o proprio
       * principio que o comentario antigo dizia seguir.
       */
      className="flex items-center gap-1.5 text-xs text-muted-foreground opacity-0"
      title={`Hora de rede — ${cidade}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-success motion-safe:animate-pulse" aria-hidden />
      <Clock3 className="size-4 shrink-0 text-muted-foreground" />
      <span className="font-mono font-semibold tabular-nums text-foreground">{fmtHora.format(agora)}</span>
      <span className="truncate capitalize">{fmtData.format(agora)}</span>
    </div>
  );
}
