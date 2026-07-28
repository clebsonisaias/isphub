import { OS_STATUS_LABEL, OsStatus } from "@isphub/shared";
import { CORES_STATUS } from "@/components/StatusDonut";

/**
 * Pilula de status — fundo neutro (a cor forte do card continua sendo so o
 * rail de SLA), mas ganha um PONTO na paleta de acento (mesmas cores do
 * StatusDonut) pra leitura rapida sem virar bloco de cor atras de texto. O
 * ponto e decorativo — nao precisa de AA como texto (so contraste minimo
 * contra o fundo, que a paleta cumpre folgado ate pro amarelo/teal). O texto
 * continua sendo a informacao real; e por ele que o e2e assere (data-testid).
 */
export function StatusBadge({ status }: { status: OsStatus }) {
  return (
    <span
      data-testid="status-badge"
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-xs font-medium text-foreground"
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: CORES_STATUS[status] }} />
      {OS_STATUS_LABEL[status]}
    </span>
  );
}
