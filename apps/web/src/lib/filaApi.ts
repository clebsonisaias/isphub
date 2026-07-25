import type { FilaFiltros, FilaItem, OrdemServico, OsStatus, Tecnico } from "@isphub/shared";
import { api } from "@/lib/apiClient";

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
  if (filtros.categoria) params.set("categoria", filtros.categoria);
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
};

export const tecnicosApi = {
  listar: (provedorId: string) => api.get<Tecnico[]>(`/provedores/${provedorId}/tecnicos`),
};
