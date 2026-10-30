import { api } from "./apiClient";
import type { TurnoAgenda } from "@isphub/shared";

export interface SugestaoRotaDto {
  tecnico: {
    id: string;
    nome: string;
  };
  paradas: {
    agendamentoId: string;
    osId: string | null;
    sgpOsId: string;
    cliente: string | null;
    bairro: string | null;
    categoria: string | null;
    ordemAtual: number | null;
    ordemSugerida: number;
    lat: number | null;
    lng: number | null;
  }[];
  ordemAtualIds: string[];
  ordemSugeridaIds: string[];
  metrosAtual: number;
  metrosSugerido: number;
  kmAtual: number;
  kmSugerido: number;
  kmEconomizado: number;
  minutosEconomizados: number;
  origem: {
    lat: number;
    lng: number;
    tipo: "veiculo_gps" | "celular_evento" | "base_empresa" | "primeira_parada";
    descricao: string;
  } | null;
}

export interface TecnicoProximoDto {
  id: string;
  nome: string;
  status: "disponivel" | "em_deslocamento" | "em_atendimento";
  statusRotulo: string;
  osAtualId: string | null;
  osAtualSgpId: string | null;
  veiculo: {
    id: string;
    rotulo: string;
    placa: string | null;
  } | null;
  posicao: {
    lat: number;
    lng: number;
    origem: "veiculo_gps" | "celular_evento" | "os_em_andamento" | "base_empresa";
    atualizadoEm: string;
  } | null;
  distanciaMetros: number | null;
  distanciaKm: number | null;
  minutosEstimados: number | null;
  paradasHoje: number;
}

export interface ProximidadeTecnicosDto {
  os: {
    id: string;
    sgpOsId: string;
    clienteNome: string | null;
    bairro: string | null;
    cidade: string | null;
    lat: number | null;
    lng: number | null;
    tipoOs: string | null;
    tecnicoAtual: string | null;
  };
  tecnicos: TecnicoProximoDto[];
  semCoordenada: boolean;
}

export const logisticaApi = {
  async obterSugestaoRota(
    tecnicoId: string,
    dia: string,
    turno?: TurnoAgenda | "dia_inteiro",
  ): Promise<SugestaoRotaDto> {
    const params = new URLSearchParams({ dia });
    if (turno) params.set("turno", turno);
    return api.get<SugestaoRotaDto>(
      `/logistica/tecnico/${tecnicoId}/rota-otimizada?${params.toString()}`,
    );
  },

  async aplicarOrdemRota(tecnicoId: string, ids: string[]): Promise<{ ok: boolean; total: number }> {
    return api.post<{ ok: boolean; total: number }>(
      `/logistica/tecnico/${tecnicoId}/aplicar-rota`,
      { ids },
    );
  },

  async obterTecnicosProximos(osId: string): Promise<ProximidadeTecnicosDto> {
    return api.get<ProximidadeTecnicosDto>(`/logistica/os/${osId}/proximidade-tecnicos`);
  },

  async despacharEmergencial(
    osId: string,
    dados: {
      tecnicoId: string;
      encaixarPrimeiro?: boolean;
      turno?: TurnoAgenda;
    },
  ): Promise<{ ok: boolean; mensagem: string }> {
    return api.post<{ ok: boolean; mensagem: string }>(
      `/logistica/os/${osId}/despacho-emergencial`,
      dados,
    );
  },
};
