import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Destaca quando o contrato nao esta ativo (cancelado, suspenso, bloqueado
 * etc) — sinal pratico pra nao despachar tecnico a toa. "Ativo" e o unico
 * valor tratado como normal; qualquer outro (ou desconhecido) vira alerta.
 */
export function ContratoStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  // Contrato ativo e o caso normal — nao vira badge (reduz ruido no card).
  // So aparece quando ha problema (cancelado/suspenso/bloqueado), que e
  // urgencia operacional real (nao despachar tecnico a toa).
  const normal = status.trim().toLowerCase() === "ativo";
  if (normal) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <AlertTriangle className="size-3" />
      Contrato {status}
    </span>
  );
}
