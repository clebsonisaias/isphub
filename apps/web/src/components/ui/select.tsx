import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `<select>` nativo com o estilo do sistema.
 *
 * Existe porque as mesmas classes estavam escritas a mao em nove lugares
 * (fila, detalhe da OS, mapa, admin de usuarios/provedores, nova conversa) —
 * com alturas diferentes entre si, e nenhuma delas chegando aos 44px de alvo
 * de toque. Uma copia divergia da outra a cada ajuste.
 *
 * Nativo de proposito: no celular ele abre o seletor do sistema (roda de
 * iOS, lista do Android), que e mais rapido e acessivel do que qualquer
 * dropdown custom — e ja vem com teclado, leitor de tela e busca por letra.
 */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 rounded-md border border-input bg-card px-3 text-sm text-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // 44px no dedo (ver a nota em button.tsx sobre pointer-coarse).
        "pointer-coarse:min-h-11",
        className,
      )}
      {...props}
    />
  );
}

export { Select };
