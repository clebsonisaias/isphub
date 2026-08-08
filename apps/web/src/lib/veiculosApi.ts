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
