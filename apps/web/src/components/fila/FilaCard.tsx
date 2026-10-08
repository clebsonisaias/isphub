import { useState, type ReactNode } from "react";
import { OS_STATUS_ABERTOS, OsPrioridade, type FilaItem } from "@isphub/shared";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { SlaBadge } from "@/components/SlaBadge";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";
import { ConexaoBadge } from "@/components/fila/ConexaoBadge";
import { copiarTexto, numeroWhatsApp } from "@/lib/clipboard";
import { iconeCategoria } from "@/lib/categoriaIcons";
import { rotuloDiaAgenda } from "@/lib/agendaApi";
import { ROTULO_TURNO } from "@isphub/shared";
import { Clock, ChevronRight, ChevronsUp, MapPin, MessageCircle, Copy, Check, UserPlus, HelpCircle, CheckCircle2, CloudOff } from "lucide-react";

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

/**
 * Classe comum dos controles inline (copiar, WhatsApp, mapa) — discretos,
 * viram destaque no hover. Area de toque >=40px no mobile (min-h/min-w, sem
 * mudar o tamanho visual do icone) sem inflar o desktop (sm: volta ao
 * compacto, so a padding natural do icone).
 */
const acaoClasse =
  "inline-flex min-h-10 min-w-10 shrink-0 items-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 justify-center rounded text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground sm:min-h-0 sm:min-w-0 sm:p-0.5";

/** Botão de copiar com feedback rápido (vira ✓ por ~1s). Para a propagação pra
 *  não abrir o detalhe da OS ao clicar. Usa fallback de clipboard (produção http). */
function BotaoCopiar({ texto, titulo }: { texto: string; titulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={async (ev) => {
        ev.stopPropagation();
        if (await copiarTexto(texto)) {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1200);
        }
      }}
      className={acaoClasse}
    >
      {copiado ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Link de ação (tel:, wa.me, mapa) — para a propagação pra não abrir o detalhe. */
function AcaoLink({
  href,
  titulo,
  externo,
  children,
}: {
  href: string;
  titulo: string;
  externo?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      title={titulo}
      aria-label={titulo}
      onClick={(ev) => ev.stopPropagation()}
      {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={acaoClasse}
    >
      {children}
    </a>
  );
}

function Campo({ label, valor, children }: { label: string; valor?: string | null; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.68rem] uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <div className="flex items-center gap-1">
        <p className="truncate text-sm font-medium text-foreground">{valor || "—"}</p>
        {valor && children}
      </div>
    </div>
  );
}

export function FilaCard({ item, agora, onClick }: { item: FilaItem; agora: number; onClick: () => void }) {
  const rail = corRail(item);
  // Título = NOSSA categoria canônica (ISPhub), não o tipo/motivo cru do SGP
  // (ex.: "REPARO CARRO"). O tipo do SGP é ruído aqui — só aparece em Tipos de
  // OS, pra o admin vincular a uma categoria nossa. Sem categoria mapeada, a OS
  // fica "Não classificado" (sinaliza que o tipo ainda precisa ser vinculado).
  const CategoriaIcone = item.categoria ? iconeCategoria(item.categoria.icone) : HelpCircle;
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
  // Abre no Google Maps: pela coordenada exata quando há geo, senão pelo texto.
  const mapaHref =
    e.lat != null && e.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`
      : local
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(local)}`
        : null;
  const destaque = dataDestaque(item);
  const decorrido = abertaHa(abertaBase(item), agora);
  const alta = item.prioridade === OsPrioridade.ALTA;
  // OS aberta e ainda sem técnico ISPhub: precisa de despacho — destaque próprio.
  const semTecnico = OS_STATUS_ABERTOS.includes(item.status) && !item.tecnicoNome;

  return (
    // <div role="button"> em vez de <button>: o card tem links/botões dentro
    // (ligar, WhatsApp, mapa, copiar) e interativo-dentro-de-<button> é DOM
    // inválido. Os controles internos dão stopPropagation pra não abrir o detalhe.
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
      {/* Rail de urgência: id, protocolo, data rotulada, SLA, prioridade alta, aberta há */}
      <div className="flex shrink-0 flex-col items-start gap-1.5 border-border/60 bg-secondary/30 p-3 sm:w-44 sm:border-r">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-tight text-muted-foreground">OS #{item.sgpOsId}</span>
          {chegouAgora(item) && (
            <span
              className="inline-flex items-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-primary"
              title="Chegou do SGP na última hora"
            >
              Nova
            </span>
          )}
          {alta && (
            <span className="inline-flex items-center gap-0.5 text-[0.7rem] font-bold text-foreground">
              <ChevronsUp className="size-3.5" />
              Alta
            </span>
          )}
        </div>

        {item.protocolo && (
          <p className="w-full truncate text-[0.68rem] text-muted-foreground/70" title={`Protocolo no SGP: ${item.protocolo}`}>
            Protocolo {item.protocolo}
          </p>
        )}

        <div className="leading-tight">
          <p className="text-[0.68rem] uppercase tracking-wide text-muted-foreground/70">{destaque.rotulo}</p>
          <p className="text-lg font-bold tabular-nums text-foreground">{destaque.grande ?? fmtHora(destaque.iso)}</p>
          <p className="text-xs text-muted-foreground">{destaque.pequeno ?? fmtData(destaque.iso)}</p>
          {item.diaAgenda && (
            // Dois estados da marcacao, pequenos: o cliente confirmou? o SGP ja
            // reflete? Sao as duas pendencias que fazem o supervisor ligar.
            <p className="mt-0.5 flex items-center gap-2 text-[0.68rem]">
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
          {item.diaAgenda && item.dataAgendamento && (
            <p className="text-[0.65rem] text-muted-foreground/60" title="Data registrada no SGP do provedor">
              SGP: {fmtData(item.dataAgendamento)} {fmtHora(item.dataAgendamento)}
            </p>
          )}
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
          {semTecnico && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
              title="OS aberta sem técnico atribuído"
            >
              <UserPlus className="size-3" />
              A despachar
            </span>
          )}
        </div>

        {item.categoria ? (
          <h3 className="flex items-center gap-1.5 text-base font-bold text-foreground">
            <CategoriaIcone className="size-4 shrink-0" style={{ color: item.categoria.cor }} />
            {item.categoria.nome}
          </h3>
        ) : (
          <h3 className="flex items-center gap-1.5 text-base font-bold text-muted-foreground">
            <HelpCircle className="size-4 shrink-0 text-warning" />
            Não classificado
          </h3>
        )}

        {local && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
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
            <BotaoCopiar texto={local} titulo="Copiar endereço" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-0.5 sm:grid-cols-4">
          <Campo label="Cliente" valor={item.clienteNome} />
          <Campo label="Contrato" valor={item.contratoId}>
            {item.contratoId && <BotaoCopiar texto={item.contratoId} titulo="Copiar contrato" />}
          </Campo>

          {/* Contato: número liga (tel:), + WhatsApp + copiar */}
          <div className="min-w-0">
            <p className="text-[0.68rem] uppercase tracking-wide text-muted-foreground/70">Contato</p>
            {item.telefone ? (
              <div className="flex items-center gap-1">
                <a
                  href={`tel:${item.telefone.replace(/[^\d+]/g, "")}`}
                  onClick={(ev) => ev.stopPropagation()}
                  title="Ligar"
                  className="truncate text-sm font-medium text-foreground transition-colors hover:text-primary hover:underline"
                >
                  {item.telefone}
                </a>
                <AcaoLink href={`https://wa.me/${numeroWhatsApp(item.telefone)}`} titulo="Abrir no WhatsApp" externo>
                  <MessageCircle className="size-3.5" />
                </AcaoLink>
                <BotaoCopiar texto={item.telefone} titulo="Copiar telefone" />
              </div>
            ) : (
              <p className="text-sm font-medium text-foreground">—</p>
            )}
          </div>

          <Campo label="Técnico" valor={item.tecnicoNome} />
        </div>
      </div>

      {/* Indicador de "abrir detalhe" */}
      <div className="hidden items-center pr-3 text-muted-foreground/50 transition-colors group-hover:text-primary sm:flex">
        <ChevronRight className="size-5" />
      </div>
    </div>
  );
}
