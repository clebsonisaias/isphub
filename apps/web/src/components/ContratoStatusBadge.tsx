import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Destaca quando o contrato nao esta ativo (cancelado, suspenso, bloqueado
 * etc) — sinal pratico pra nao despachar tecnico a toa. "Ativo" e o unico
 * valor tratado como normal; qualquer outro (ou desconhecido) vira alerta.
 */
export function ContratoStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const normal = status.trim().toLowerCase() === "ativo";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        normal
          ? "border-border bg-secondary/50 text-muted-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {!normal && <AlertTriangle className="size-3" />}
      Contrato {status}
    </span>
  );
}
