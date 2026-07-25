import { useEffect, useRef } from "react";
import { createScope, createTimeline, svg, stagger, type Scope } from "animejs";
import { cn } from "@/lib/utils";

/**
 * Momento de marca do ISPhub: um glifo de "hub" de rede (no central + nos
 * satelites conectados por linhas) que se desenha e se monta, seguido do
 * wordmark. Uso escopado (ver plano): so em telas de marca/login, nunca em
 * densidade operacional.
 */
export function BrandMark({ className }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const scope = useRef<Scope | null>(null);

  useEffect(() => {
    scope.current = createScope({ root }).add(() => {
      createTimeline({ defaults: { ease: "outQuad" } })
        .add(svg.createDrawable(".hub-line"), {
          draw: ["0 0", "0 1"],
          duration: 650,
          delay: stagger(90),
        })
        .add(
          ".hub-node",
          { scale: [0, 1], duration: 420, delay: stagger(70), ease: "outBack" },
          "-=350",
        )
        .add(".brand-word", { opacity: [0, 1], translateY: [10, 0], duration: 500 }, "-=250");
    });

    return () => scope.current?.revert();
  }, []);

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
