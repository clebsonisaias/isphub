import { ROTULO_TURNO, rotuloDataHora, type OsEvento, type OsTimelineItem, type TurnoAgenda } from "@isphub/shared";

/**
 * Textos da trilha da agenda (marcou, remarcou, desmarcou, confirmou, abriu a OS) para a timeline
 * e para a linha "quem marcou" da OS. Puro: a rota so busca e chama.
 */

export interface EventoAgenda {
  id: string;
  tipo: string;
  dia?: Date | null;
  turno?: TurnoAgenda | null;
  diaAnterior?: Date | null;
  turnoAnterior?: TurnoAgenda | null;
  origem: string;
  autor?: string | null;
  canal?: string | null;
  protocolo?: string | null;
  osSituacao?: string | null;
  criadoEm: Date;
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "sex 30/10, manhã" a partir do DATE da agenda (meia-noite UTC = o dia civil). */
export function rotuloJanela(dia?: Date | null, turno?: TurnoAgenda | null): string {
  if (!dia) return "data não informada";
  const dd = String(dia.getUTCDate()).padStart(2, "0");
  const mm = String(dia.getUTCMonth() + 1).padStart(2, "0");
  const t = turno ? `, ${ROTULO_TURNO[turno].toLowerCase()}` : "";
  return `${SEMANA[dia.getUTCDay()]} ${dd}/${mm}${t}`;
}

/** Quem fez, curto, para o campo de autor da timeline. */
export function rotuloOrigem(origem: string, autor?: string | null): string {
  switch (origem) {
    case "atendai_ia":
      return "IA do AtendAI";
    case "atendai_humano":
      return autor ? `${autor} (AtendAI)` : "Atendimento (AtendAI)";
    case "cliente":
      return "Cliente";
    case "sgp":
      return "SGP";
    case "auto":
      return "Agenda automática";
    case "planilha":
      return "Planilha";
    default:
      return autor ?? "ISPhub";
  }
}

function porQuem(origem: string, autor?: string | null): string {
  switch (origem) {
    case "atendai_ia":
      return "pela IA do AtendAI";
    case "atendai_humano":
      return autor ? `por ${autor} (AtendAI)` : "pelo atendimento do AtendAI";
    case "cliente":
      return "pelo cliente";
    case "sgp":
      return "no SGP";
    case "auto":
      return "pela agenda automática";
    case "planilha":
      return "pela planilha";
    default:
      return autor ? `por ${autor}` : "no ISPhub";
  }
}

function situacaoDaOs(s?: string | null): string {
  if (s === "ja_aberta") return " · a OS já estava aberta";
  if (s === "aberta_agora") return " · OS aberta no mesmo atendimento";
  return "";
}

function extras(e: Pick<EventoAgenda, "canal" | "protocolo">): string {
  return `${e.canal ? ` · ${e.canal}` : ""}${e.protocolo ? ` · protocolo ${e.protocolo}` : ""}`;
}

export function descreverEventoAgenda(e: EventoAgenda): string {
  const por = porQuem(e.origem, e.autor);
  const quando = rotuloJanela(e.dia, e.turno);
  switch (e.tipo) {
    case "os_aberta":
      return `OS aberta ${por}${extras(e)}`;
    case "marcado":
      return `Visita marcada para ${quando} ${por}${situacaoDaOs(e.osSituacao)}${extras(e)}`;
    case "remarcado":
      return `Visita remarcada de ${rotuloJanela(e.diaAnterior, e.turnoAnterior)} para ${quando} ${por}${extras(e)}`;
    case "desmarcado":
      return `Visita de ${quando} desmarcada ${por}${extras(e)}`;
    case "confirmado":
      return `Cliente confirmou a visita de ${quando}`;
    default:
      return `${e.tipo} ${por}`;
  }
}

/**
 * A timeline da OS: os eventos da OS, a trilha da agenda e a abertura no SGP (do espelho), mais
 * recente primeiro. A abertura do espelho so entra quando nao ha aviso de abertura do parceiro —
 * os dois contariam a mesma coisa.
 */
export function montarTimeline(
  daOs: OsEvento[],
  agenda: EventoAgenda[],
  os: { usuario: string | null; dataCadastro: Date | null },
): OsTimelineItem[] {
  const daAgenda: OsTimelineItem[] = agenda.map((e) => ({
    id: `ag:${e.id}`,
    tipo: e.tipo === "os_aberta" ? "abertura" : "agenda",
    autorNome: rotuloOrigem(e.origem, e.autor),
    descricao: descreverEventoAgenda(e),
    criadoEm: e.criadoEm.toISOString(),
  }));
  const abertura: OsTimelineItem[] =
    os.dataCadastro && !agenda.some((e) => e.tipo === "os_aberta")
      ? [{ id: "abertura", tipo: "abertura", autorNome: os.usuario, descricao: "OS aberta no SGP", criadoEm: os.dataCadastro.toISOString() }]
      : [];
  return [...daOs, ...daAgenda, ...abertura].sort((a, b) => Date.parse(b.criadoEm) - Date.parse(a.criadoEm));
}

/** A linha curta "quem marcou" da OS. Nulo sem marcacao ativa. */
export function resumoMarcacao(a: { status: string; origem: string; marcadoPor: string | null; osSituacao: string | null; atualizadoEm: Date } | null): string | null {
  if (!a || a.status !== "marcado") return null;
  return `Marcada ${porQuem(a.origem, a.marcadoPor)} em ${rotuloDataHora(a.atualizadoEm.toISOString())}${situacaoDaOs(a.osSituacao)}`;
}
