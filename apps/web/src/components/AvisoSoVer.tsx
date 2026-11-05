import { Eye } from "lucide-react";

/**
 * Aviso discreto no topo da tela quando o supervisor tem a área só em "ver":
 * os botões de ação somem, e sem o aviso parecia defeito da tela.
 */
export function AvisoSoVer() {
  return (
    <p role="status" className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
      <Eye className="size-4 shrink-0" aria-hidden />
      Você tem acesso só para visualizar.
    </p>
  );
}
