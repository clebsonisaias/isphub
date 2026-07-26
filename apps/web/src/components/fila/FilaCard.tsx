import { OsPrioridade, type FilaItem } from "@isphub/shared";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { SlaBadge } from "@/components/SlaBadge";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";
import { ConexaoBadge } from "@/components/fila/ConexaoBadge";
import { PRIORIDADE_LABEL } from "@/lib/filaFacets";
import { iconeCategoria } from "@/lib/categoriaIcons";
import { cn } from "@/lib/utils";
import { Clock, ChevronRight, HelpCircle } from "lucide-react";

/** Cor da barra lateral do card, pelo semáforo de SLA (só OS tem SLA). */
function corRail(item: FilaItem): string {
  if (item.kind !== "os") return "var(--border)";
  switch (item.sla.semaforo) {
    case "vermelho":
      return "var(--destructive)";
    case "amarelo":
      return "var(--warning)";
    case "verde":
      return "var(--success)";
    default:
      return "var(--border)";
  }
}

const PRIORIDADE_ESTILO: Record<OsPrioridade, string> = {
  [OsPrioridade.ALTA]: "bg-destructive text-destructive-foreground",
  [OsPrioridade.NORMAL]: "bg-warning text-white",
  [OsPrioridade.BAIXA]: "bg-success text-white",
};

function dataBase(item: FilaItem): string | null {
  return item.kind === "os"
    ? item.dataAgendamento ?? item.dataCadastro ?? item.criadoEm
    : item.dataAgendamento ?? item.dataCadastro ?? item.sincronizadoEm;
}

function abertaBase(item: FilaItem): string | null {
  return item.kind === "os" ? item.dataCadastro ?? item.criadoEm : item.dataCadastro ?? null;
}

function fmtHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtData(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/** "Aberta há 3h 15min" — tempo decorrido desde a abertura, relativo a `agora`. */
function abertaHa(iso: string | null, agora: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.floor((agora - t) / 60000));
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}min`;
  const dias = Math.floor(h / 24);
  return `${dias}d ${h % 24}h`;
}

/** Chip com a categoria canonica do tipo de OS (ou "Não classificado", em destaque). */
function CategoriaChip({ item }: { item: FilaItem }) {
  if (item.kind !== "os") return null;
  if (!item.categoria) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
        <HelpCircle className="size-3" />
        Não classificado
      </span>
    );
  }
  const Icone = iconeCategoria(item.categoria.icone);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ borderColor: `${item.categoria.cor}40`, backgroundColor: `${item.categoria.cor}18`, color: item.categoria.cor }}
    >
      <Icone className="size-3" />
      {item.categoria.nome}
    </span>
  );
}

function Campo({ label, valor }: { label: string; valor?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.68rem] uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <p className="truncate text-sm font-medium text-foreground">{valor || "—"}</p>
    </div>
  );
}

export function FilaCard({ item, agora, onClick }: { item: FilaItem; agora: number; onClick: () => void }) {
  const rail = corRail(item);
  const idLabel = item.kind === "os" ? `OS #${item.sgpOsId}` : `Nº ${item.sgpNumero}`;
  const titulo =
    item.kind === "os"
      ? item.tipoDescricao ?? "Ordem de Serviço"
      : item.tipo ?? "Ocorrência";
  const local =
    item.kind === "os" && item.endereco.logradouro
      ? `${item.endereco.logradouro}${item.endereco.bairro ? ` — ${item.endereco.bairro}` : ""}`
      : item.pop
        ? `POP: ${item.pop}`
        : null;
  const decorrido = abertaHa(abertaBase(item), agora);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderLeftColor: rail, borderLeftWidth: 4 }}
      className="fila-item group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left opacity-0 shadow-sm transition-all hover:border-primary/40 hover:shadow-md sm:flex-row"
    >
      {/* Rail: id, prioridade, hora/data, aberta há */}
      <div className="flex shrink-0 flex-col items-start gap-1.5 border-border/60 bg-secondary/30 p-3 sm:w-40 sm:border-r">
        <span className="text-xs font-semibold tracking-tight text-muted-foreground">{idLabel}</span>
        {item.kind === "os" ? (
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-bold",
              PRIORIDADE_ESTILO[item.prioridade],
            )}
          >
            {PRIORIDADE_LABEL[item.prioridade]}
          </span>
        ) : (
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
            Ocorrência
          </span>
        )}
        <div className="mt-0.5 leading-tight">
          <p className="text-lg font-bold tabular-nums text-foreground">{fmtHora(dataBase(item))}</p>
          <p className="text-xs text-muted-foreground">{fmtData(dataBase(item))}</p>
        </div>
        {decorrido && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground">
            <Clock className="size-3" />
            Aberta há {decorrido}
          </span>
        )}
      </div>

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <ProvedorBadge provedor={item.provedor} />
          {item.kind === "os" ? (
            <StatusBadge status={item.status} />
          ) : (
            <span className="rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-xs text-muted-foreground">
              {item.status ?? "—"}
            </span>
          )}
          <ContratoStatusBadge status={item.contratoStatus} />
          <CategoriaChip item={item} />
          {item.kind === "os" && <SlaBadge sla={item.sla} />}
          <ConexaoBadge provedorId={item.provedorId} contratoId={item.contratoId} />
        </div>

        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-base font-bold text-foreground">{titulo}</h3>
          {local && <span className="text-sm text-muted-foreground">· {local}</span>}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-0.5 sm:grid-cols-4">
          <Campo label="Cliente" valor={item.clienteNome} />
          <Campo label="Contrato" valor={item.contratoId} />
          {item.kind === "os" ? (
            <>
              <Campo label="Cidade" valor={item.endereco.cidade ?? item.pop} />
              <Campo label="Técnico" valor={item.tecnicoNome} />
            </>
          ) : (
            <>
              <Campo label="Método" valor={item.metodo} />
              <Campo label="Responsável" valor={item.responsavel} />
            </>
          )}
        </div>
      </div>

      {/* Indicador de "abrir detalhe" */}
      <div className="hidden items-center pr-3 text-muted-foreground/50 transition-colors group-hover:text-primary sm:flex">
        <ChevronRight className="size-5" />
      </div>
    </button>
  );
}
