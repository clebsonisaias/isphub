import type { EvidenciaResumo, FilaFiltros, FilaItem, OrdemServico, OsEvento, OsStatus } from "@isphub/shared";
import { api } from "@/lib/apiClient";
import type { ImagemComprimida } from "@/lib/imagem";

/** Tecnico no seletor de atribuicao — usuario ISPhub com role=tecnico. */
export interface TecnicoResumo {
  id: string;
  nome: string;
  email: string;
}

interface FilaResponse {
  /** Total real de OS no banco pro filtro atual, via count. */
  total: number;
  /**
   * true quando o conjunto devolvido nao cobre o total (bateu no teto do
   * servidor) — a UI deve avisar pra refinar, nunca exibir lista incompleta
   * como se fosse tudo.
   */
  truncado: boolean;
  itens: FilaItem[];
  /** Contagem real por grupo (do banco, nao do que coube na pagina). */
  totais: { osAbertas: number; osFechadas: number; osSlaEstourado: number };
}

function buildQuery(filtros: FilaFiltros): string {
  const params = new URLSearchParams();
  if (filtros.provedorId) params.set("provedorId", filtros.provedorId);
  if (filtros.status?.length) params.set("status", filtros.status.join(","));
  if (filtros.tipoOsId) params.set("tipoOsId", filtros.tipoOsId);
  if (filtros.tecnicoId) params.set("tecnicoId", filtros.tecnicoId);
  if (filtros.categoriaId) params.set("categoriaId", filtros.categoriaId);
  if (filtros.grupo) params.set("grupo", filtros.grupo);
  if (filtros.equipe) params.set("equipe", filtros.equipe);
  if (filtros.busca) params.set("busca", filtros.busca);
  if (filtros.de) params.set("de", filtros.de);
  if (filtros.ate) params.set("ate", filtros.ate);
  if (filtros.page) params.set("page", String(filtros.page));
  if (filtros.pageSize) params.set("pageSize", String(filtros.pageSize));
  return params.toString();
}

export const filaApi = {
  listar: (filtros: FilaFiltros) => api.get<FilaResponse>(`/fila?${buildQuery(filtros)}`),
};

export const ordensServicoApi = {
  obter: (id: string) => api.get<OrdemServico>(`/ordens-servico/${id}`),
  aCaminho: (id: string) => api.post<OrdemServico>(`/ordens-servico/${id}/acaminho`),
  mudarStatus: (id: string, status: OsStatus) => api.patch<OrdemServico>(`/ordens-servico/${id}/status`, { status }),
  anotar: (id: string, texto: string) => api.post<OrdemServico>(`/ordens-servico/${id}/anotacoes`, { texto }),
  atribuir: (id: string, tecnicoId: string) => api.post<OrdemServico>(`/ordens-servico/${id}/atribuir`, { tecnicoId }),
  eventos: (id: string) => api.get<OsEvento[]>(`/ordens-servico/${id}/eventos`),
  evidencias: {
    listar: (id: string) => api.get<EvidenciaResumo[]>(`/ordens-servico/${id}/evidencias`),
    /** Devolve a lista completa e atualizada de fotos (o SGP e a fonte da verdade, nao ha "a nova" isolada). */
    adicionar: (id: string, imagem: ImagemComprimida, legenda?: string) =>
      api.post<EvidenciaResumo[]>(`/ordens-servico/${id}/evidencias`, { ...imagem, legenda }),
    urlArquivo: (id: string, anexoId: string) => `/ordens-servico/${id}/evidencias/${anexoId}/arquivo`,
  },
};

export const tecnicosApi = {
  listar: () => api.get<TecnicoResumo[]>("/tecnicos"),
};
