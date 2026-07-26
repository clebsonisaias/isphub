import { useEffect, useRef, useState } from "react";
import { animate } from "animejs";
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

  useEffect(() => {
    if (!rootRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      rootRef.current.style.opacity = "1";
      return;
    }
    animate(rootRef.current, { opacity: [0, 1], translateY: [-6, 0], duration: 400, ease: "outQuad" });
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
      className="hidden items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-muted-foreground opacity-0 lg:flex"
      title={`Hora de rede — ${cidade}`}
    >
      <Clock3 className="size-3.5 shrink-0" />
      <span className="font-semibold tabular-nums text-foreground">{fmtHora.format(agora)}</span>
      <span className="text-muted-foreground/70">·</span>
      <span className="capitalize">{fmtData.format(agora)}</span>
      <span className="hidden text-muted-foreground/70 lg:inline">· {cidade}</span>
    </div>
  );
}
