import { useEffect, useRef } from "react";
import { createScope, animate, stagger, type Scope } from "animejs";
import { cn } from "@/lib/utils";

/**
 * Loading de pagina cheia: o glifo de marca (mesmo hub de rede do BrandMark)
 * pulsando em loop, em vez de um "Carregando..." puro. Usado no gate de
 * autenticacao (RequireAuth) — a primeira coisa que aparece ao abrir o app.
 * Loop desativado se o usuario preferir menos movimento (o glifo fica
 * estatico, so o texto avisa que esta carregando).
 */
export function BrandLoader({ className }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const scope = useRef<Scope | null>(null);

  useEffect(() => {
    if (!root.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    scope.current = createScope({ root }).add(() => {
      animate(".loader-node", {
        scale: [1, 1.25],
        opacity: [0.6, 1],
        duration: 700,
        loop: true,
        alternate: true,
        delay: stagger(120),
        ease: "inOutSine",
      });
      animate(".loader-line", {
        opacity: [0.25, 0.8],
        duration: 700,
        loop: true,
        alternate: true,
        delay: stagger(120),
        ease: "inOutSine",
      });
    });
    return () => scope.current?.revert();
  }, []);

  return (
    <div
      className={cn("flex min-h-svh flex-col items-center justify-center gap-4", className)}
      role="status"
      aria-live="polite"
    >
      <div ref={root}>
        <svg width="64" height="64" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="loader-gradient" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
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
              className="loader-line"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="url(#loader-gradient)"
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
            <circle key={i} className="loader-node" cx={cx} cy={cy} r="9" fill="url(#loader-gradient)" />
          ))}
          <circle className="loader-node" cx="60" cy="60" r="13" fill="url(#loader-gradient)" />
        </svg>
      </div>
      <span className="text-sm text-muted-foreground">Carregando...</span>
    </div>
  );
}
