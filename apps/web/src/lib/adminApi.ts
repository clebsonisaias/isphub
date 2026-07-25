import type { ErpConfigPublic, Provedor, TipoOs } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const provedoresApi = {
  listar: () => api.get<Provedor[]>("/provedores"),
  obter: (id: string) => api.get<Provedor>(`/provedores/${id}`),
  criar: (data: { nome: string; cor: string; logoUrl?: string | null }) =>
    api.post<Provedor>("/provedores", data),
  atualizar: (id: string, data: Partial<{ nome: string; cor: string; logoUrl: string | null; ativo: boolean }>) =>
    api.put<Provedor>(`/provedores/${id}`, data),
  remover: (id: string) => api.delete<void>(`/provedores/${id}`),
};

export const erpConfigApi = {
  obter: (provedorId: string) => api.get<ErpConfigPublic>(`/provedores/${provedorId}/erp-config`),
  salvar: (provedorId: string, data: { url: string; app: string; token: string; intervaloPollingSegundos?: number }) =>
    api.put<ErpConfigPublic>(`/provedores/${provedorId}/erp-config`, data),
  testar: (provedorId: string) =>
    api.post<{ ok: boolean; message?: string }>(`/provedores/${provedorId}/erp-config/testar`),
};

export const tiposOsApi = {
  listar: (provedorId: string) => api.get<TipoOs[]>(`/provedores/${provedorId}/tipos-os`),
  importar: (provedorId: string) =>
    api.post<{ importados: number; tipos: TipoOs[] }>(`/provedores/${provedorId}/tipos-os/importar`),
  atualizar: (
    provedorId: string,
    tipoId: string,
    data: Partial<{ visivel: boolean; slaHoras: number | null; categoria: "ocorrencia" | "instalacao" }>,
  ) => api.patch<TipoOs>(`/provedores/${provedorId}/tipos-os/${tipoId}`, data),
};

export const syncApi = {
  disparar: (provedorId: string) => api.post<{ ok: boolean; message?: string }>(`/provedores/${provedorId}/sync`),
};
