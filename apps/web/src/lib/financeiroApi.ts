import type {
  BaixaInput,
  CategoriaFinanceiraPublic,
  ClassificacaoDre,
  ComposicaoCategoria,
  DreResultado,
  InadimplenciaResultado,
  LancamentoEventoPublic,
  LancamentoFiltro,
  LancamentoInput,
  LancamentoListaResposta,
  LancamentoPublic,
  Regime,
  AbastecimentoPublic,
  CartaoPublic,
  MovimentoCartaoTipo,
  TipoCombustivel,
  VeiculoPublic,
  ParcelamentoInput,
  ParcelamentoPublic,
  RecorrenciaInput,
  RecorrenciaPublic,
  RecorrenciaSalva,
  ResultadoGeracao,
  SerieMensalResultado,
} from "@isphub/shared";
import { api } from "@/lib/apiClient";

/**
 * Cliente do financeiro da HubISP.
 *
 * Nenhuma funcao daqui devolve dinheiro como `number`: os campos monetarios
 * chegam como string e assim ficam ate a formatacao. Se alguem precisar de um
 * total, ele vem do servidor dentro de `resumo` — a lista NAO deve ser somada
 * aqui: somaria so a pagina, e passaria por aritmetica de float pra fazer isso.
 */
// `object`, nao `Record<string, unknown>`: uma interface declarada (como
// LancamentoFiltro) nao tem index signature e por isso nao e atribuivel a
// Record — o TypeScript recusaria a chamada mesmo estando tudo certo.
function query(params: object): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const financeiroApi = {
  listar: (filtro: LancamentoFiltro & { limite?: number; offset?: number } = {}) =>
    api.get<LancamentoListaResposta>(`/financeiro/lancamentos${query(filtro)}`),

  obter: (id: string) => api.get<LancamentoPublic>(`/financeiro/lancamentos/${id}`),

  historico: (id: string) =>
    api.get<LancamentoEventoPublic[]>(`/financeiro/lancamentos/${id}/historico`),

  criar: (dados: LancamentoInput) =>
    api.post<LancamentoPublic>("/financeiro/lancamentos", dados),

  editar: (id: string, dados: Partial<LancamentoInput>) =>
    api.patch<LancamentoPublic>(`/financeiro/lancamentos/${id}`, dados),

  baixar: (id: string, dados: BaixaInput) =>
    api.post<LancamentoPublic>(`/financeiro/lancamentos/${id}/baixa`, dados),

  estornar: (id: string) =>
    api.delete<LancamentoPublic>(`/financeiro/lancamentos/${id}/baixa`),

  /** Cancelar substitui excluir: registro de dinheiro nao some do banco. */
  cancelar: (id: string, motivo?: string) =>
    api.post<LancamentoPublic>(`/financeiro/lancamentos/${id}/cancelamento`, { motivo }),

  enviarComprovante: (id: string, arquivoBase64: string, mime: string, nome: string) =>
    api.put<LancamentoPublic>(`/financeiro/lancamentos/${id}/comprovante`, {
      arquivoBase64,
      mime,
      nome,
    }),

  removerComprovante: (id: string) =>
    api.delete<LancamentoPublic>(`/financeiro/lancamentos/${id}/comprovante`),

  categorias: () => api.get<CategoriaFinanceiraPublic[]>("/financeiro/categorias"),

  criarCategoria: (dados: { nome: string; tipo: "receita" | "despesa"; cor?: string }) =>
    api.post<CategoriaFinanceiraPublic>("/financeiro/categorias", dados),

  /** `classificacao: null` LIMPA; omitir mantem a atual. */
  editarCategoria: (
    id: string,
    dados: { nome?: string; cor?: string; ativo?: boolean; classificacao?: ClassificacaoDre | null },
  ) => api.patch<CategoriaFinanceiraPublic>(`/financeiro/categorias/${id}`, dados),

  // --- relatorios ---
  dre: (p: PeriodoRelatorio) => api.get<DreResultado>(`/financeiro/relatorios/dre${query(p)}`),

  inadimplencia: () =>
    api.get<InadimplenciaResultado>("/financeiro/relatorios/inadimplencia"),

  serieMensal: (p: PeriodoRelatorio) =>
    api.get<SerieMensalResultado>(`/financeiro/relatorios/serie-mensal${query(p)}`),

  composicaoDespesa: (p: PeriodoRelatorio) =>
    api.get<ComposicaoCategoria[]>(`/financeiro/relatorios/composicao-despesa${query(p)}`),
};

/** Recorte dos relatorios: meses "YYYY-MM" e o regime. Tudo opcional. */
export interface PeriodoRelatorio {
  de?: string;
  ate?: string;
  regime?: Regime;
}

/** Recorrências — a regra que gera lançamentos repetidos. */
export const recorrenciaApi = {
  /** `provisoes`: true = só provisões, false = só recorrências comuns. */
  listar: (opts: { tipo?: "receita" | "despesa"; provisoes?: boolean } = {}) =>
    api.get<RecorrenciaPublic[]>(`/financeiro/recorrencias${query(opts)}`),

  ocorrencias: (id: string) =>
    api.get<LancamentoPublic[]>(`/financeiro/recorrencias/${id}/ocorrencias`),

  criar: (dados: RecorrenciaInput) =>
    api.post<RecorrenciaSalva>("/financeiro/recorrencias", dados),

  editar: (id: string, dados: Partial<Omit<RecorrenciaInput, "tipo">> & { ativa?: boolean }) =>
    api.patch<RecorrenciaSalva>(`/financeiro/recorrencias/${id}`, dados),

  gerar: (id: string) =>
    api.post<ResultadoGeracao>(`/financeiro/recorrencias/${id}/gerar`),
};

/** Parcelamentos — uma compra dividida em N vezes. */
export const parcelamentoApi = {
  listar: (tipo?: "receita" | "despesa") =>
    api.get<ParcelamentoPublic[]>(`/financeiro/parcelamentos${tipo ? `?tipo=${tipo}` : ""}`),

  parcelas: (id: string) => api.get<LancamentoPublic[]>(`/financeiro/parcelamentos/${id}/parcelas`),

  criar: (dados: ParcelamentoInput) => api.post<ParcelamentoPublic>("/financeiro/parcelamentos", dados),
};

/** Frota — veículos, abastecimentos e cartão-combustível. */
export const frotaApi = {
  veiculos: () => api.get<VeiculoPublic[]>("/financeiro/frota/veiculos"),
  criarVeiculo: (d: { placa: string; modelo: string; ano?: number | null }) =>
    api.post<{ id: string }>("/financeiro/frota/veiculos", d),
  alternarVeiculo: (id: string, ativo: boolean) =>
    api.patch<{ ok: true }>(`/financeiro/frota/veiculos/${id}`, { ativo }),

  abastecimentos: (veiculoId?: string) =>
    api.get<AbastecimentoPublic[]>(`/financeiro/frota/abastecimentos${veiculoId ? `?veiculoId=${veiculoId}` : ""}`),
  registrarAbastecimento: (d: {
    veiculoId: string;
    data: string;
    km: number;
    litros: string;
    valorTotal: string;
    combustivel: TipoCombustivel;
    posto?: string | null;
    tanqueCheio?: boolean;
  }) => api.post<{ id: string }>("/financeiro/frota/abastecimentos", d),

  cartoes: () => api.get<CartaoPublic[]>("/financeiro/frota/cartoes"),
  criarCartao: (d: { numero: string; titularId?: string | null }) =>
    api.post<{ id: string }>("/financeiro/frota/cartoes", d),
  movimentos: (id: string) =>
    api.get<{ id: string; tipo: MovimentoCartaoTipo; valor: string; data: string; descricao: string | null }[]>(
      `/financeiro/frota/cartoes/${id}/movimentos`,
    ),
  movimentar: (id: string, d: { tipo: MovimentoCartaoTipo; valor: string; data: string; descricao?: string | null }) =>
    api.post<{ id: string }>(`/financeiro/frota/cartoes/${id}/movimentos`, d),
};
