import type {
  BaixaInput,
  CategoriaFinanceiraPublic,
  LancamentoEventoPublic,
  LancamentoFiltro,
  LancamentoInput,
  LancamentoListaResposta,
  LancamentoPublic,
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
};
