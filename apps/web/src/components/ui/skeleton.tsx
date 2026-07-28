import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Bloco de carregamento generico — quem usa monta o layout final com varios
 * Skeleton (mesma grade/proporcoes da tela real), pra nao ter pulo quando o
 * dado chega. `animate-pulse` ja respeita prefers-reduced-motion via CSS do
 * Tailwind (reduz a amplitude, nao desliga — pulso e feedback de estado, nao
 * so decoracao).
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-secondary/70", className)} {...props} />;
}

export { Skeleton };
