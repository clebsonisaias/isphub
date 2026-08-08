import type { StatusVeiculo, TipoVeiculo } from "@isphub/shared";
import { api } from "@/lib/apiClient";

/**
 * Cliente do cadastro de veiculos do modulo Frota.
 *
 * ATENCAO ao nome: `lib/financeiroApi.ts` ja exporta um `frotaApi`, que bate em
 * `/financeiro/frota/*` — abastecimento, cartao-combustivel, consumo — e so
 * ADMIN alcanca. Este aqui bate em `/frota/*`, o angulo OPERACIONAL, que ADMIN
 * e GESTOR alcancam.
 *
 * Chamar-se `veiculosApi` e proposital: dois `frotaApi` em modulos diferentes
 * seria armadilha silenciosa — importar do errado nao daria erro de tipo, so
 * "essa funcao nao existe" em runtime. Rastreador e ocupacao ganharao clientes
 * proprios pelo mesmo motivo.
 */

export interface VeiculoFrota {
  id: string;
  placa: string;
  /** Com hifen no formato antigo. Use SEMPRE este pra exibir. */
  placaFormatada: string;
  modelo: string;
  marca: string | null;
  ano: number | null;
  cor: string | null;
  tipo: TipoVeiculo;
  status: StatusVeiculo;
  odometroKm: number | null;
  renavam: string | null;
  chassi: string | null;
  provedorId: string | null;
  provedorNome: string | null;
  criadoEm: string;
}

export interface VeiculoInput {
  placa?: string;
  modelo?: string;
  marca?: string | null;
  ano?: number | null;
  cor?: string | null;
  tipo?: TipoVeiculo;
  status?: StatusVeiculo;
  provedorId?: string | null;
  odometroKm?: number | null;
  renavam?: string | null;
  chassi?: string | null;
}

export const veiculosApi = {
  listar: (provedorId?: string) =>
    api.get<VeiculoFrota[]>(`/frota/veiculos${provedorId ? `?provedorId=${encodeURIComponent(provedorId)}` : ""}`),

  obter: (id: string) => api.get<VeiculoFrota>(`/frota/veiculos/${id}`),

  criar: (dados: VeiculoInput) => api.post<VeiculoFrota>("/frota/veiculos", dados),

  editar: (id: string, dados: VeiculoInput) => api.patch<VeiculoFrota>(`/frota/veiculos/${id}`, dados),
};

export interface VeiculoNoMapa {
  veiculoId: string;
  placa: string;
  modelo: string;
  tipo: TipoVeiculo;
  provedorNome: string | null;
  lat: number;
  lng: number;
  velocidadeKmh: number | null;
  registradoEm: string;
  movendo: boolean | null;
  comunicando: boolean | null;
  rastreadorId: string;
  ocupantes: string[];
}

export interface MapaResposta {
  /**
   * O relogio do SERVIDOR. A IDADE da posicao e o que decide se o gestor pode
   * confiar no pino, e medi-la com o relogio do navegador daria numero
   * diferente em cada maquina. Mesmo padrao da jornada.
   */
  agoraServidor: string;
  veiculos: VeiculoNoMapa[];
}

export interface PontoTrilha {
  lat: number;
  lng: number;
  em: string;
  velocidadeKmh: number | null;
}

export interface OcupacaoLinha {
  id: string;
  veiculoId: string;
  veiculoPlaca: string;
  usuarioId: string;
  usuarioNome: string;
  papel: "motorista" | "passageiro";
  origem: "declaracao" | "jornada" | "ajuste";
  declaradoPorNome: string;
  inicioEm: string;
  fimEm: string | null;
}

export interface RastreadorLinha {
  id: string;
  identificadorExterno: string;
  apelido: string | null;
  ativo: boolean;
  ultimaPosicaoEm: string | null;
  comunicando: boolean | null;
  rastreando: boolean | null;
  veiculo: { id: string; placa: string; modelo: string } | null;
}

export const frotaMapaApi = {
  mapa: () => api.get<MapaResposta>("/frota/mapa"),

  trilha: (veiculoId: string, params: { de?: string; ate?: string; precisao?: "alta" | "media" } = {}) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) usp.set(k, v);
    const q = usp.toString();
    return api.get<PontoTrilha[]>(`/frota/veiculos/${veiculoId}/trilha${q ? `?${q}` : ""}`);
  },

  ocupacoesAbertas: () => api.get<OcupacaoLinha[]>("/frota/ocupacoes/abertas"),

  ocupantesEm: (veiculoId: string, em?: string) =>
    api.get<OcupacaoLinha[]>(`/frota/veiculos/${veiculoId}/ocupantes${em ? `?em=${encodeURIComponent(em)}` : ""}`),

  rastreadores: () => api.get<RastreadorLinha[]>("/frota/rastreadores"),

  criarRastreador: (dados: { identificadorExterno: string; apelido?: string | null }) =>
    api.post<{ id: string }>("/frota/rastreadores", dados),

  vincular: (rastreadorId: string, veiculoId: string) =>
    api.post<{ id: string }>(`/frota/rastreadores/${rastreadorId}/vincular`, { veiculoId }),

  desvincular: (rastreadorId: string) => api.post<void>(`/frota/rastreadores/${rastreadorId}/desvincular`, {}),
};
