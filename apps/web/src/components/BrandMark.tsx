import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsapSetup";
import { cn } from "@/lib/utils";

/**
 * Momento de marca do ISPhub: um glifo de "hub" de rede (no central + nos
 * satelites conectados por linhas) que se desenha e se monta, seguido do
 * wordmark. Uso escopado (ver plano): so em telas de marca/login, nunca em
 * densidade operacional.
 */
export function BrandMark({ className }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      // Lacuna do original fechada aqui: o glifo nao verificava
      // prefers-reduced-motion. Reduzido, so aplica o estado final (traço
      // completo, escala 1, wordmark visivel) sem a sequencia.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(".hub-line", { drawSVG: "100%" });
        gsap.set(".hub-node", { scale: 1 });
        gsap.set(".brand-word", { opacity: 1, y: 0 });
        return;
      }
      const tl = gsap.timeline({ defaults: { ease: "power1.out" } });
      // fromTo em tudo: os elementos nascem no estado natural do SVG (traço
      // completo, escala 1), sem CSS escondendo nada — o inicio de cada
      // animacao precisa ser explicito, nao inferido do estado atual.
      tl.fromTo(".hub-line", { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.65, stagger: 0.09 })
        .fromTo(
          ".hub-node",
          { scale: 0 },
          { scale: 1, duration: 0.42, stagger: 0.07, ease: "back.out(1.7)" },
          "-=0.35",
        )
        .fromTo(".brand-word", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 }, "-=0.25");
    },
    // dependencies:[] e OBRIGATORIO junto de `scope` — sem ele o hook reexecuta
    // a cada render (igual useEffect sem array), e o StrictMode do React
    // (2 renders no mount) mata a timeline antes dela sair do frame 0.
    { scope: root, dependencies: [] },
  );

  return (
    <div ref={root} className={cn("flex items-center gap-4", className)}>
      <svg width="56" height="56" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="hub-gradient" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--brand-from)" />
            <stop offset="1" stopColor="var(--brand-to)" />
          </linearGradient>
        </defs>
        {[
          [60, 60, 22, 22],
          [60, 60, 98, 22],
          [60, 60, 22, 98],
          [60, 60, 98, 98],
        ].map(([x1, y1, x2, y2], i) => (
          <line
            key={i}
            className="hub-line"
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="url(#hub-gradient)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        ))}
        {[
          [22, 22],
          [98, 22],
          [22, 98],
          [98, 98],
        ].map(([cx, cy], i) => (
          <circle key={i} className="hub-node" cx={cx} cy={cy} r="9" fill="url(#hub-gradient)" />
        ))}
        <circle className="hub-node" cx="60" cy="60" r="13" fill="url(#hub-gradient)" />
      </svg>
      <div className="brand-word flex flex-col leading-none opacity-0">
        <span className="text-3xl font-bold tracking-tight">
          <span className="brand-gradient-text">ISP</span>
          <span className="text-foreground">hub</span>
        </span>
        <span className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Soluções completas para provedores de internet
        </span>
      </div>
    </div>
  );
}
