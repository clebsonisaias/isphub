import type { EstadoManutencao, PlanoManutencaoDto, StatusVeiculo, TipoVeiculo } from "@isphub/shared";
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
  /** Como a operacao chama o carro ("C011"). */
  apelido: string | null;
  /** `"C011 · RGI4H16"` — montado no SERVIDOR, pra toda tela dizer o mesmo. */
  rotulo: string;
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
  apelido?: string | null;
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

export interface PlanoComEstado extends PlanoManutencaoDto {
  estado: EstadoManutencao;
}

/** Manutencao preventiva por veiculo: planos com o estado derivado do odometro atual. */
export const manutencaoApi = {
  listar: (veiculoId: string) => api.get<{ odometroKm: number | null; planos: PlanoComEstado[] }>(`/frota/veiculos/${veiculoId}/manutencoes`),
  criar: (veiculoId: string, d: { tipo: string; intervaloKm?: number | null; intervaloDias?: number | null; ultimaKm?: number | null; ultimaEm?: string | null }) =>
    api.post<{ odometroKm: number | null; planos: PlanoComEstado[] }>(`/frota/veiculos/${veiculoId}/manutencoes`, d),
  concluir: (id: string, km?: number | null) =>
    api.post<{ odometroKm: number | null; planos: PlanoComEstado[] }>(`/frota/manutencoes/${id}/concluir`, km != null ? { km } : {}),
  remover: (id: string) => api.delete<void>(`/frota/manutencoes/${id}`),
};

export interface ChecklistResumo {
  id: string;
  momento: "saida" | "retorno";
  odometroKm: number | null;
  combustivelPct: number | null;
  avarias: string | null;
  temFoto: boolean;
  criadoEm: string;
  usuarioNome: string;
  ocupacaoId: string;
}

export const checklistApi = {
  listar: (veiculoId: string) => api.get<ChecklistResumo[]>(`/frota/veiculos/${veiculoId}/checklists`),
  urlFoto: (id: string) => `/frota/checklists/${id}/foto`,
};

export interface VeiculoNoMapa {
  veiculoId: string;
  placa: string;
  /// `"C011 · RGI4H16"` — montado no SERVIDOR.
  rotulo: string;
  modelo: string;
  tipo: TipoVeiculo;
  provedorNome: string | null;
  lat: number;
  lng: number;
  velocidadeKmh: number | null;
  registradoEm: string;
  movendo: boolean | null;
  comunicando: boolean | null;
  /** Tri-estado em todos: `null` = o aparelho nao contou, e nao "esta desligado". */
  ignicao: "ligada" | "desligada" | "anomalia" | null;
  bateriaPct: number | null;
  bloqueado: boolean | null;
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

  /**
   * "Qual viatura fez a OS X?" — LISTA, porque podem ter sido duas: o carro que
   * quebrou de manha e o que terminou o dia.
   *
   * ADMIN/GESTOR: quem chamar sem o gate leva 403 na propria OS.
   */
  veiculosDaOs: (osId: string) =>
    api.get<{ veiculoId: string; veiculoPlaca: string; veiculoRotulo: string; usuarioNome: string }[]>(
      `/frota/ordens-servico/${osId}/veiculos`,
    ),

  rastreadores: () => api.get<RastreadorLinha[]>("/frota/rastreadores"),

  criarRastreador: (dados: { identificadorExterno: string; apelido?: string | null }) =>
    api.post<{ id: string }>("/frota/rastreadores", dados),

  vincular: (rastreadorId: string, veiculoId: string) =>
    api.post<{ id: string }>(`/frota/rastreadores/${rastreadorId}/vincular`, { veiculoId }),

  desvincular: (rastreadorId: string) => api.post<void>(`/frota/rastreadores/${rastreadorId}/desvincular`, {}),

  /**
   * O que a conta do fornecedor tem e o ISPhub ainda nao.
   *
   * A chave de API e vinculada a UMA conta: trocar a chave troca a frota que o
   * sistema enxerga por inteiro. Sem isto, o gestor teria de abrir o portal do
   * fornecedor e copiar identificador por identificador.
   */
  disponiveis: () => api.get<RastreadorDisponivel[]>("/frota/rastreadores/disponiveis"),

  importar: (itens: { identificadorExterno: string; placa: string; modelo?: string | null }[]) =>
    api.post<ResultadoImportacao[]>("/frota/rastreadores/importar", { itens }),
};

export interface CredencialRastreamento {
  id: string;
  baseUrl: string;
  /** Mascarada NO SERVIDOR. A chave inteira nunca sai de la. */
  chaveMascarada: string;
  intervaloPollingSegundos: number;
  ativo: boolean;
  ultimaColetaEm: string | null;
  ultimaColetaOk: boolean | null;
  ultimaColetaMensagem: string | null;
}

export const credencialRastreamentoApi = {
  obter: () => api.get<CredencialRastreamento | null>("/frota/config"),
  salvar: (chave: string) => api.put<CredencialRastreamento>("/frota/config", { chave }),
  testar: () => api.post<{ ok: boolean; mensagem?: string }>("/frota/config/testar", {}),
};

export interface RastreadorDisponivel {
  identificadorExterno: string;
  nome: string | null;
  modelo: string | null;
  intervaloSegundos: number | null;
  temComandoCorte: boolean;
  instaladoEm: string | null;
  /** Palpite do servidor a partir do apelido. A tela PEDE confirmacao. */
  placaSugerida: string | null;
  veiculoExistenteId: string | null;
}

export interface ResultadoImportacao {
  identificadorExterno: string;
  placa: string;
  veiculoCriado: boolean;
  rastreadorId: string;
}

export interface CercaVirtualDto {
  id: string;
  provedorId: string | null;
  nome: string;
  tipo: "circulo" | "poligono";
  centroLat: number | null;
  centroLng: number | null;
  raioMetros: number | null;
  vertices: { lat: number; lng: number }[] | null;
  cor: string;
  ativa: boolean;
  criadoEm: string;
}

export const cercasApi = {
  listar: () => api.get<CercaVirtualDto[]>("/frota/cercas"),
  criar: (dados: {
    nome: string;
    tipo?: "circulo" | "poligono";
    centroLat?: number;
    centroLng?: number;
    raioMetros?: number;
    vertices?: { lat: number; lng: number }[];
    cor?: string;
  }) => api.post<CercaVirtualDto>("/frota/cercas", dados),
  atualizar: (id: string, dados: { nome?: string; ativa?: boolean; cor?: string; raioMetros?: number }) =>
    api.patch<CercaVirtualDto>(`/frota/cercas/${id}`, dados),
  excluir: (id: string) => api.delete(`/frota/cercas/${id}`),
};

export const geocodeApi = {
  reverter: (lat: number, lng: number) =>
    api.get<{ endereco: string | null }>(`/frota/geocode?lat=${lat}&lng=${lng}`),
};
