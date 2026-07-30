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
       * `2xl` e nao `xl`: em `xl` (1280px) o relogio cabia na conta so no
       * papel — somado as pilulas de navegacao ele empurrava busca,
       * notificacoes e menu do usuario fora da tela. Ele e o item de MENOR
       * valor do cabecalho (hora e data o sistema operacional ja mostra),
       * entao e ele que espera por espaco de verdade, nao os controles.
       */
      className="hidden items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-muted-foreground opacity-0 2xl:flex"
      title={`Hora de rede — ${cidade}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-success motion-safe:animate-pulse" aria-hidden />
      <Clock3 className="size-3.5 shrink-0" />
      <span className="font-mono font-semibold tabular-nums text-foreground">{fmtHora.format(agora)}</span>
      <span className="text-muted-foreground/70">·</span>
      <span className="capitalize">{fmtData.format(agora)}</span>
      <span className="hidden text-muted-foreground/70 2xl:inline">· {cidade}</span>
    </div>
  );
}
