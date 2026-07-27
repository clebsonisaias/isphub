import { OsPrioridade, type FilaItem } from "@isphub/shared";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { SlaBadge } from "@/components/SlaBadge";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";
import { ConexaoBadge } from "@/components/fila/ConexaoBadge";
import { Clock, ChevronRight, ChevronsUp, MapPin } from "lucide-react";

/** Cor da barra lateral do card, pelo semáforo de SLA. É a ÚNICA cor forte do
 * card — urgência manda; o resto dos badges fica neutro pra não competir. */
function corRail(item: FilaItem): string {
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

/** Data em destaque + rótulo do que ela é: agendamento (se houver) ou abertura. */
function dataDestaque(item: FilaItem): { rotulo: string; iso: string | null } {
  if (item.dataAgendamento) return { rotulo: "Agendada", iso: item.dataAgendamento };
  return { rotulo: "Aberta", iso: item.dataCadastro ?? item.criadoEm };
}

/** Base do "aberta há": data real de abertura no SGP (cadastro), senão criação local. */
function abertaBase(item: FilaItem): string | null {
  return item.dataCadastro ?? item.criadoEm;
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

/** "3h 15min" — tempo decorrido desde a abertura, relativo a `agora`. */
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
  const titulo = item.tipoDescricao ?? "Ordem de Serviço";
  // Endereço mais completo disponível: rua+nº — bairro, cidade; senão só a
  // cidade; senão o POP (localidade). A rua/bairro vêm do cadastro do cliente
  // (backfill), não da listagem de OS — por isso o fallback importa.
  const e = item.endereco;
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const local = rua
    ? `${rua}${e.bairro ? ` — ${e.bairro}` : ""}${e.cidade ? `, ${e.cidade}` : ""}`
    : e.cidade
      ? e.cidade
      : item.pop
        ? `POP: ${item.pop}`
        : null;
  const destaque = dataDestaque(item);
  const decorrido = abertaHa(abertaBase(item), agora);
  const alta = item.prioridade === OsPrioridade.ALTA;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderLeftColor: rail, borderLeftWidth: 4 }}
      className="fila-item group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md sm:flex-row"
    >
      {/* Rail de urgência: id, data rotulada, SLA, prioridade alta, aberta há */}
      <div className="flex shrink-0 flex-col items-start gap-1.5 border-border/60 bg-secondary/30 p-3 sm:w-44 sm:border-r">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-tight text-muted-foreground">OS #{item.sgpOsId}</span>
          {alta && (
            <span className="inline-flex items-center gap-0.5 text-[0.7rem] font-bold text-foreground">
              <ChevronsUp className="size-3.5" />
              Alta
            </span>
          )}
        </div>

        <div className="leading-tight">
          <p className="text-[0.68rem] uppercase tracking-wide text-muted-foreground/70">{destaque.rotulo}</p>
          <p className="text-lg font-bold tabular-nums text-foreground">{fmtHora(destaque.iso)}</p>
          <p className="text-xs text-muted-foreground">{fmtData(destaque.iso)}</p>
        </div>

        <SlaBadge sla={item.sla} />

        {decorrido && (
          <span
            className="mt-0.5 inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground"
            title="Tempo desde a abertura no SGP"
          >
            <Clock className="size-3" />
            aberta há {decorrido}
          </span>
        )}
      </div>

      {/* Conteúdo (badges neutros — cor é só do rail/SLA) */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <ProvedorBadge provedor={item.provedor} />
          <StatusBadge status={item.status} />
          <ContratoStatusBadge status={item.contratoStatus} />
          <ConexaoBadge provedorId={item.provedorId} contratoId={item.contratoId} />
        </div>

        <h3 className="text-base font-bold text-foreground">{titulo}</h3>

        {local && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{local}</span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-0.5 sm:grid-cols-4">
          <Campo label="Cliente" valor={item.clienteNome} />
          <Campo label="Contrato" valor={item.contratoId} />
          <Campo label="Contato" valor={item.telefone} />
          <Campo label="Técnico" valor={item.tecnicoNome} />
        </div>
      </div>

      {/* Indicador de "abrir detalhe" */}
      <div className="hidden items-center pr-3 text-muted-foreground/50 transition-colors group-hover:text-primary sm:flex">
        <ChevronRight className="size-5" />
      </div>
    </button>
  );
}
