import type { ReactNode } from "react";
import { GeoDecor } from "@/components/GeoDecor";
import { cn } from "@/lib/utils";

/**
 * Ilustracao flat leve — motivo de rede/no (ecoa o BrandMark: hub central +
 * pontas coloridas), recolorida via tokens pra acompanhar tema/paleta sem
 * precisar de asset externo.
 */
function EmptyIllustration() {
  return (
    <svg viewBox="0 0 120 100" className="h-24 w-auto" aria-hidden>
      <ellipse cx="60" cy="86" rx="38" ry="6" className="fill-primary/10" />
      <rect x="28" y="34" width="64" height="44" rx="10" className="fill-card stroke-border" strokeWidth={2} />
      <circle cx="46" cy="56" r={4} className="fill-accent-pink" />
      <circle cx="60" cy="56" r={4} className="fill-accent-yellow" />
      <circle cx="74" cy="56" r={4} className="fill-accent-teal" />
      <path d="M60 34V18" className="stroke-primary" strokeWidth={3} strokeLinecap="round" />
      <circle cx="60" cy="14" r={6} className="fill-primary" />
      <path d="M46 18l-10-6M74 18l10-6" className="stroke-primary/60" strokeWidth={3} strokeLinecap="round" />
      <circle cx="34" cy="10" r={4} className="fill-accent-blue" />
      <circle cx="86" cy="10" r={4} className="fill-accent-green" />
    </svg>
  );
}

/**
 * Estado vazio padrao — ilustracao + titulo + descricao opcional + acao
 * opcional, com GeoDecor sutil atras. Reusado em fila vazia, dashboard sem
 * dados, retiradas, listas de admin.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative flex flex-col items-center gap-3 overflow-hidden rounded-xl py-10 text-center", className)}>
      <GeoDecor variant="empty" />
      <div className="relative z-10 flex flex-col items-center gap-3">
        <EmptyIllustration />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-foreground">{title}</p>
          {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
