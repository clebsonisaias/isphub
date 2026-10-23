import { OS_STATUS_ABERTOS, OsPrioridade, ROTULO_TURNO, type FilaItem } from "@isphub/shared";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { SlaBadge } from "@/components/SlaBadge";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";
import { iconeCategoria } from "@/lib/categoriaIcons";
import { rotuloDiaAgenda } from "@/lib/agendaApi";
import { ChevronRight, ChevronsUp, MapPin, UserPlus, HelpCircle, CheckCircle2, CloudOff, Wrench } from "lucide-react";

/**
 * Chegou no espelho ha pouco? `criadoEm` e do ISPhub, nao do SGP: e literalmente
 * "apareceu aqui agora".
 *
 * Existe porque a queixa recorrente e "abri no SGP e nao apareceu" — e varias
 * vezes a OS ESTAVA na tela, so que numa faixa de SLA que a joga pro fim da
 * lista. Uma marca resolve o "nao vi" sem mexer na ordenacao, que e por
 * urgencia de proposito: quem esta estourando prazo tem que vir antes de quem
 * acabou de chegar.
 */
const CHEGOU_AGORA_MS = 60 * 60_000;

function chegouAgora(item: FilaItem): boolean {
  const t = Date.parse(item.criadoEm ?? "");
  return !Number.isNaN(t) && Date.now() - t < CHEGOU_AGORA_MS;
}

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
function dataDestaque(item: FilaItem): { rotulo: string; iso: string | null; grande?: string; pequeno?: string } {
  // A marcacao da agenda ISPhub vence a data do SGP: e ela que o supervisor
  // escolheu, e o SGP so a reflete depois do write-back. Nao tem hora — a
  // agenda e por turno — entao o destaque vira o dia e a linha de baixo o turno.
  if (item.diaAgenda && item.turnoAgenda) {
    const parada = item.ordemRota != null ? ` · ${item.ordemRota}ª parada` : "";
    return { rotulo: "Visita", iso: null, grande: rotuloDiaAgenda(item.diaAgenda), pequeno: `${ROTULO_TURNO[item.turnoAgenda]}${parada}` };
  }
  if (item.dataAgendamento) return { rotulo: "Agendada", iso: item.dataAgendamento };
  return { rotulo: "Aberta", iso: item.dataCadastro ?? item.criadoEm };
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

/**
 * Card de duas linhas: o que decide "quem vai, pra onde, quando" fica aqui;
 * protocolo, contato, contrato, conexao e "aberta ha" moram no detalhe. O
 * card e `role="button"` (e nao <button>) porque o endereco e um link de mapa
 * dentro dele — interativo-dentro-de-<button> e DOM invalido.
 */
export function FilaCard({ item, onClick }: { item: FilaItem; onClick: () => void }) {
  const rail = corRail(item);
  // Título = NOSSA categoria canônica (ISPhub), não o tipo/motivo cru do SGP
  // (ex.: "REPARO CARRO"). Sem categoria mapeada, a OS fica "Não classificado"
  // (sinaliza que o tipo ainda precisa ser vinculado em Tipos de OS).
  const CategoriaIcone = item.categoria ? iconeCategoria(item.categoria.icone) : HelpCircle;
  // Endereço mais completo disponível: rua+nº — bairro, cidade; senão só a
  // cidade; senão o POP (localidade).
  const e = item.endereco;
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const local = rua
    ? `${rua}${e.bairro ? ` — ${e.bairro}` : ""}${e.cidade ? `, ${e.cidade}` : ""}`
    : e.cidade
      ? e.cidade
      : item.pop
        ? `POP: ${item.pop}`
        : null;
  const mapaHref =
    e.lat != null && e.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`
      : local
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(local)}`
        : null;
  const destaque = dataDestaque(item);
  const alta = item.prioridade === OsPrioridade.ALTA;
  // OS aberta e ainda sem técnico ISPhub: precisa de despacho — destaque próprio.
  const semTecnico = OS_STATUS_ABERTOS.includes(item.status) && !item.tecnicoNome;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onClick();
        }
      }}
      style={{ borderLeftColor: rail, borderLeftWidth: 4 }}
      className="fila-item group flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-soft-sm transition-all hover:border-primary/40 hover:shadow-soft-md motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row"
    >
      {/* Rail de urgência: id, quando, SLA. No celular vira uma faixa no topo —
          como coluna ele comia 144px dos 375 e os selos quebravam em 4 linhas. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 bg-secondary/30 px-3 py-2 sm:w-44 sm:flex-col sm:flex-nowrap sm:items-start sm:gap-1 sm:border-b-0 sm:border-r sm:p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold tracking-tight text-muted-foreground">#{item.sgpOsId}</span>
          {chegouAgora(item) && (
            <span className="rounded-full bg-primary/15 px-1.5 text-[0.6rem] font-bold uppercase text-primary" title="Chegou do SGP na última hora">
              Nova
            </span>
          )}
          {alta && (
            <span className="inline-flex items-center text-[0.68rem] font-bold text-foreground" title="Prioridade alta">
              <ChevronsUp className="size-3.5" />
              Alta
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-1.5 leading-tight sm:block">
          <p className="text-[0.62rem] uppercase tracking-wide text-muted-foreground/70">{destaque.rotulo}</p>
          <p className="text-sm font-bold tabular-nums text-foreground sm:text-base">{destaque.grande ?? fmtHora(destaque.iso)}</p>
          <p className="truncate text-xs text-muted-foreground">{destaque.pequeno ?? fmtData(destaque.iso)}</p>
          {item.diaAgenda && (
            // Duas pendencias que fazem o supervisor ligar: cliente confirmou? SGP reflete?
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.65rem]">
              {item.visitaConfirmadaEm ? (
                <span className="inline-flex items-center gap-0.5 text-success" title={`Cliente confirmou em ${new Date(item.visitaConfirmadaEm).toLocaleString("pt-BR")}`}>
                  <CheckCircle2 className="size-3" /> confirmada
                </span>
              ) : (
                <span className="text-muted-foreground/70" title="O cliente ainda não confirmou a visita">sem confirmação</span>
              )}
              {!item.visitaSgpConfirmadaEm && (
                <span className="inline-flex items-center gap-0.5 text-warning" title="A data ainda não foi refletida no SGP do provedor">
                  <CloudOff className="size-3" /> SGP
                </span>
              )}
            </p>
          )}
        </div>
        <div className="truncate">
          <SlaBadge sla={item.sla} />
        </div>
      </div>

      {/* Duas linhas: o que / quem / onde; depois provedor, status e técnico */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-3 py-2.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className={`flex items-center gap-1.5 text-sm font-bold ${item.categoria ? "text-foreground" : "text-muted-foreground"}`}>
            <CategoriaIcone className="size-4 shrink-0" style={item.categoria ? { color: item.categoria.cor } : undefined} />
            {item.categoria?.nome ?? "Não classificado"}
          </h3>
          <span className="truncate text-sm font-medium text-foreground">{item.clienteNome || "—"}</span>
          {local && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              {mapaHref ? (
                <a
                  href={mapaHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(ev) => ev.stopPropagation()}
                  title="Abrir no mapa"
                  className="truncate transition-colors hover:text-primary hover:underline"
                >
                  {local}
                </a>
              ) : (
                <span className="truncate">{local}</span>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ProvedorBadge provedor={item.provedor} />
          <StatusBadge status={item.status} />
          <ContratoStatusBadge status={item.contratoStatus} />
          {semTecnico ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
              title="OS aberta sem técnico atribuído"
            >
              <UserPlus className="size-3" />
              A despachar
            </span>
          ) : (
            item.tecnicoNome && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                title={item.apoioNomes?.length ? `Técnico · apoio: ${item.apoioNomes.join(", ")}` : "Técnico"}
              >
                <Wrench className="size-3" />
                {item.tecnicoNome}
                {item.apoioNomes?.length ? <span className="text-muted-foreground/70">+ {item.apoioNomes.join(", ")}</span> : null}
              </span>
            )
          )}
        </div>
      </div>

      <div className="hidden items-center pr-2 text-muted-foreground/50 transition-colors group-hover:text-primary sm:flex">
        <ChevronRight className="size-5" />
      </div>
    </div>
  );
}
