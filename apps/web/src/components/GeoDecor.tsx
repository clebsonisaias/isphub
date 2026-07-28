import { cn } from "@/lib/utils";

/**
 * Formas Memphis (triangulo, meia-lua, grade de pontos, listras, blob) —
 * textura decorativa reaproveitada nos momentos "herois" (login, vazios,
 * cabecalhos de secao). SEMPRE aria-hidden + pointer-events-none + atras do
 * conteudo — o pai precisa ser `relative`/`overflow-hidden`; nunca por cima de
 * texto de dado operacional (ver mapa de intensidade ludico x calmo do
 * redesign: isso e so pros momentos expressivos, nao pra fila/tabelas/forms).
 */

function Triangle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 38" className={className} fill="currentColor" aria-hidden>
      <polygon points="22,2 42,36 2,36" />
    </svg>
  );
}

function HalfMoon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="currentColor" aria-hidden>
      <path d="M20 2a18 18 0 1 0 0 36 13 13 0 0 1 0-36Z" />
    </svg>
  );
}

function DotGrid({ className }: { className?: string }) {
  const dots = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      dots.push(<circle key={`${row}-${col}`} cx={6 + col * 14} cy={6 + row * 14} r={2.5} />);
    }
  }
  return (
    <svg viewBox="0 0 40 40" className={className} fill="currentColor" aria-hidden>
      {dots}
    </svg>
  );
}

function Stripes({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 60 40"
      className={className}
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="round"
      fill="none"
      aria-hidden
    >
      <line x1="4" y1="36" x2="20" y2="4" />
      <line x1="20" y1="36" x2="36" y2="4" />
      <line x1="36" y1="36" x2="52" y2="4" />
    </svg>
  );
}

function Blob({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="currentColor" aria-hidden>
      <path d="M35 6c18-8 41 0 50 17 8 16 5 38-10 49-16 12-42 13-56-2C4 55 0 34 10 20 16 12 25 10 35 6Z" />
    </svg>
  );
}

export type GeoDecorVariant = "hero" | "empty" | "corner";

export function GeoDecor({ variant = "hero", className }: { variant?: GeoDecorVariant; className?: string }) {
  if (variant === "corner") {
    return (
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
        <DotGrid className="absolute -right-2 -top-2 size-16 text-primary/10" />
      </div>
    );
  }

  if (variant === "empty") {
    return (
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
        <Triangle className="absolute left-6 top-6 size-9 rotate-[18deg] text-accent-teal/20" />
        <DotGrid className="absolute right-8 top-8 size-12 text-primary/10" />
        <HalfMoon className="absolute bottom-6 left-10 size-9 -rotate-12 text-accent-pink/15" />
      </div>
    );
  }

  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <Blob className="absolute -left-16 -top-16 size-64 text-primary/10" />
      <Triangle className="absolute right-10 top-16 size-12 rotate-12 text-accent-yellow/25" />
      <DotGrid className="absolute left-12 bottom-24 size-20 text-accent-teal/20" />
      <Stripes className="absolute right-16 bottom-16 size-16 text-accent-pink/25" />
      <HalfMoon className="absolute right-1/3 top-1/4 size-14 rotate-45 text-accent-blue/15" />
    </div>
  );
}
