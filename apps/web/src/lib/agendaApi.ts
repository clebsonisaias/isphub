import { ROTULO_TURNO, type AgendaConfigDto, type OsStatus, type TurnoAgenda, type VagaTurno } from "@isphub/shared";
import { api } from "./apiClient";

/**
 * A agenda de OS — o que a operação mantinha numa planilha no Drive.
 *
 * Separado de `filaApi` de propósito: a fila responde "o que existe pra fazer",
 * a agenda responde "o que cabe amanhã de manhã". São duas perguntas, e a
 * segunda tem uma resposta que a primeira nunca teve — um limite.
 */

export interface PropostaRedistribuicao {
  paradas: {
    agendamentoId: string;
    ordemServicoId: string;
    sgpOsId: string;
    clienteNome: string | null;
    regiao: string | null;
    tecnicoSugeridoId: string | null;
  }[];
  candidatos: { tecnicoId: string; nome: string; carga: number }[];
  tetoPorTecnico: number | null;
  semDestino: string[];
}

export interface GradeResposta {
  config: AgendaConfigDto;
  vagas: VagaTurno[];
}

/** Uma parada da rota do dia. */
/** Um dia que foge da regra do calendário — feriado municipal, ou mutirão. */
export interface ExcecaoAgenda {
  id: string;
  dia: string;
  atende: boolean;
  motivo: string;
  definidoPor: string | null;
}

export interface ParadaAgenda {
  id: string;
  sgpOsId: string;
  ordemRota: number | null;
  /** Nulo = o cliente ainda não respondeu o lembrete (≠ "não vem"). */
  confirmadoEm: string | null;
  remarcacoesCliente: number;
  regiao: string | null;
  origem: string;
  marcadoPor: string | null;
  observacao: string | null;
  sgpConfirmadoEm: string | null;
  provedor: { id: string; nome: string; cor: string };
  ordemServico: {
    id: string;
    status: OsStatus;
    clienteNome: string | null;
    telefone: string | null;
    bairro: string | null;
    logradouro: string | null;
    numero: string | null;
    cidade: string | null;
    pop: string | null;
    lat: number | null;
    lng: number | null;
    tecnico: { id: string; nome: string; nomeExibicao: string | null } | null;
    tipoOs: { descricao: string | null; categoria: { nome: string; cor: string } | null } | null;
  } | null;
}

const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "sex 10/10" — o dia da agenda como a grade e o card mostram. */
export function rotuloDiaAgenda(dia: string) {
  const d = new Date(`${dia}T12:00:00Z`);
  return `${DIA_SEMANA[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "sex 10/10, Manhã" — como o card e o detalhe anunciam a marcação. */
export function rotuloVisita(dia: string, turno: TurnoAgenda) {
  return `${rotuloDiaAgenda(dia)}, ${ROTULO_TURNO[turno]}`;
}

/** `2026-09-10` — o dia como o servidor espera (DATE, sem hora nem fuso). */
export function diaISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const agendaApi = {
  grade: (params?: { de?: string; ate?: string; regiao?: string }) => {
    const q = new URLSearchParams();
    if (params?.de) q.set("de", params.de);
    if (params?.ate) q.set("ate", params.ate);
    if (params?.regiao) q.set("regiao", params.regiao);
    const s = q.toString();
    return api.get<GradeResposta>(`/agenda/vagas${s ? `?${s}` : ""}`);
  },

  /** Só o que cabe. Nada bloqueado sai daqui — ver a rota no servidor. */
  proximas: (quantas = 6, regiao?: string) => {
    const q = new URLSearchParams({ quantas: String(quantas) });
    if (regiao) q.set("regiao", regiao);
    return api.get<VagaTurno[]>(`/agenda/proximas?${q}`);
  },

  doTurno: (dia: string, turno: TurnoAgenda) =>
    api.get<ParadaAgenda[]>(`/agenda/turno?dia=${dia}&turno=${turno}`),

  marcar: (d: {
    provedorId: string;
    sgpOsId: string;
    dia: string;
    turno: TurnoAgenda;
    regiao?: string | null;
    observacao?: string | null;
  }) => api.post<{ id: string }>("/agenda", d),

  desmarcar: (id: string) => api.delete<{ id: string }>(`/agenda/${id}`),

  /** A ordem sugerida por proximidade (nao grava — `definirRota` grava quando o supervisor aceita). */
  sugestao: (dia: string, turno: TurnoAgenda) =>
    api.get<{ ordem: string[]; metros: number; metrosAtual: number; semCoordenada: number; comOrigem: boolean }>(
      `/agenda/turno/sugestao?dia=${dia}&turno=${turno}`,
    ),

  /** Quem assume as paradas de quem faltou — proposta, nao grava. */
  redistribuicao: (dia: string, turno: TurnoAgenda, usuarioId: string) =>
    api.get<PropostaRedistribuicao>(`/agenda/redistribuicao?dia=${dia}&turno=${turno}&usuarioId=${usuarioId}`),
  redistribuir: (itens: { agendamentoId: string; tecnicoId: string }[]) =>
    api.post<{ aplicadas: number }>("/agenda/redistribuir", { itens }),

  /** A rota inteira de uma vez: arrastar uma parada renumera todas. */
  definirRota: (dia: string, turno: TurnoAgenda, ids: string[]) =>
    api.put<ParadaAgenda[]>("/agenda/rota", { dia, turno, ids }),

  lerConfig: () => api.get<AgendaConfigDto>("/admin/agenda"),
  salvarConfig: (patch: Partial<AgendaConfigDto>) => api.put<AgendaConfigDto>("/admin/agenda", patch),

  /** Só as exceções cadastradas — feriado nacional é calculado, não listado. */
  excecoes: () => api.get<ExcecaoAgenda[]>("/admin/agenda/excecoes"),
  salvarExcecao: (d: { dia: string; atende: boolean; motivo: string }) =>
    api.put<ExcecaoAgenda[]>("/admin/agenda/excecoes", d),
  removerExcecao: (dia: string) => api.delete<ExcecaoAgenda[]>(`/admin/agenda/excecoes/${dia}`),
};
