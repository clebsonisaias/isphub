import type { Categoria, ErpConfigPublic, ModuloId, Provedor, TipoOs, UserRole, UsuarioPublic } from "@isphub/shared";
import { api } from "@/lib/apiClient";

/** Item do catálogo de módulos com o estado atual (o que GET /admin/modulos devolve). */
export interface ModuloAdmin {
  id: ModuloId;
  nome: string;
  icone: string;
  core: boolean;
  ativo: boolean;
  ordem: number;
  rolesPermitidos: UserRole[];
}

export const modulosApi = {
  listar: () => api.get<ModuloAdmin[]>("/admin/modulos"),
  atualizar: (moduloId: ModuloId, data: Partial<{ ativo: boolean; ordem: number; rolesPermitidos: UserRole[] }>) =>
    api.patch<unknown>(`/admin/modulos/${moduloId}`, data),
};

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
    data: Partial<{ visivel: boolean; slaHoras: number | null; categoriaId: string | null }>,
  ) => api.patch<TipoOs>(`/provedores/${provedorId}/tipos-os/${tipoId}`, data),
  autoClassificar: (provedorId: string) =>
    api.post<{ analisados: number; classificados: number }>(`/provedores/${provedorId}/tipos-os/auto-classificar`),
};

export const syncApi = {
  disparar: (provedorId: string) => api.post<{ ok: boolean; message?: string }>(`/provedores/${provedorId}/sync`),
};

export const categoriasApi = {
  listar: () => api.get<Categoria[]>("/categorias"),
  criar: (
    data: Pick<Categoria, "nome" | "cor"> &
      Partial<Pick<Categoria, "icone" | "palavrasChave" | "slaHorasPadrao" | "equipeExterna" | "ordem" | "ativo">>,
  ) => api.post<Categoria>("/categorias", data),
  atualizar: (id: string, data: Partial<Omit<Categoria, "id">>) => api.put<Categoria>(`/categorias/${id}`, data),
  remover: (id: string) => api.delete<Categoria | void>(`/categorias/${id}`),
};

export const usuariosApi = {
  listar: (role?: UserRole) => api.get<UsuarioPublic[]>(`/usuarios${role ? `?role=${role}` : ""}`),
  criar: (data: { nome: string; email: string; senha: string; role: UserRole; provedorId?: string | null }) =>
    api.post<UsuarioPublic>("/usuarios", data),
  atualizar: (
    id: string,
    data: { nome: string; email: string; role: UserRole; provedorId?: string | null; ativo: boolean },
  ) => api.put<UsuarioPublic>(`/usuarios/${id}`, data),
  redefinirSenha: (id: string, novaSenha: string) =>
    api.post<UsuarioPublic>(`/usuarios/${id}/senha`, { novaSenha }),
  remover: (id: string) => api.delete<UsuarioPublic>(`/usuarios/${id}`),
};
