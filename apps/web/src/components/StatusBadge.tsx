import { OS_STATUS_LABEL, OsStatus } from "@isphub/shared";

/**
 * Rotulo neutro do status da OS. A cor no card e reservada pra urgencia (SLA) —
 * status vira texto sobrio pra nao competir com o semaforo. O texto continua
 * sendo a informacao; e por ele que o e2e assere (data-testid).
 */
export function StatusBadge({ status }: { status: OsStatus }) {
  return (
    <span
      data-testid="status-badge"
      className="inline-flex items-center rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-xs font-medium text-foreground"
    >
      {OS_STATUS_LABEL[status]}
    </span>
  );
}
