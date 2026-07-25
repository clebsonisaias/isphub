import { OS_STATUS_LABEL, OsStatus } from "@isphub/shared";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<OsStatus, string> = {
  [OsStatus.ABERTA]: "bg-secondary text-foreground border-border",
  [OsStatus.EM_DESLOCAMENTO]: "bg-warning/15 text-warning border-warning/30",
  [OsStatus.EM_EXECUCAO]: "bg-primary/15 text-primary border-primary/30",
  [OsStatus.CONCLUIDA]: "bg-success/15 text-success border-success/30",
  [OsStatus.CANCELADA]: "bg-destructive/15 text-destructive border-destructive/30",
  [OsStatus.PENDENTE]: "bg-warning/15 text-warning border-warning/30",
};

export function StatusBadge({ status }: { status: OsStatus }) {
  return (
    <span
      data-testid="status-badge"
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLE[status],
      )}
    >
      {OS_STATUS_LABEL[status]}
    </span>
  );
}
