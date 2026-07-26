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
  total: number;
  page: number;
  pageSize: number;
  itens: FilaItem[];
}

function buildQuery(filtros: FilaFiltros): string {
  const params = new URLSearchParams();
  if (filtros.provedorId) params.set("provedorId", filtros.provedorId);
  if (filtros.status?.length) params.set("status", filtros.status.join(","));
  if (filtros.tipoOsId) params.set("tipoOsId", filtros.tipoOsId);
  if (filtros.tecnicoId) params.set("tecnicoId", filtros.tecnicoId);
  if (filtros.categoriaId) params.set("categoriaId", filtros.categoriaId);
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
  /** Reescreve a descrição da OS (write-back pro SGP). */
  editarConteudo: (id: string, conteudo: string) =>
    api.patch<OrdemServico>(`/ordens-servico/${id}/conteudo`, { conteudo }),
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
