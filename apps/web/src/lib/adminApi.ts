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

/** O que `GET /provedores/:id/atendai` devolve — nenhum segredo, por construção. */
export interface AtendaiConfigPublic {
  id: string;
  baseUrl: string;
  chaveMascarada: string;
  temSegredoWebhook: boolean;
  ativo: boolean;
  /** Identifica QUAL chave de entrada está ativa sem revelar nenhuma. */
  chaveEntradaPrefixo: string | null;
  chaveEntradaUsoEm: string | null;
  /** Chat interno ligado ao do AtendAI (nulo = desligado). */
  chatLigadoEm: string | null;
}

export const atendaiConfigApi = {
  obter: (provedorId: string) => api.get<AtendaiConfigPublic | null>(`/provedores/${provedorId}/atendai`),
  salvar: (provedorId: string, data: { baseUrl: string; chave: string; ativo?: boolean }) =>
    api.put<void>(`/provedores/${provedorId}/atendai`, data),
  testar: (provedorId: string) =>
    api.post<{ ok: boolean; erro?: string; colaboradores?: number }>(`/provedores/${provedorId}/atendai/testar`),
  /** Devolve a chave em claro — a ÚNICA vez em que ela existe fora do hash. */
  gerarChaveEntrada: (provedorId: string) =>
    api.post<{ chave: string }>(`/provedores/${provedorId}/atendai/chave-entrada`),
  revogarChaveEntrada: (provedorId: string) =>
    api.delete<void>(`/provedores/${provedorId}/atendai/chave-entrada`),
  /** Gera a chave e a entrega ao AtendAI numa tacada — sem copia-e-cola. */
  ligarAgendamento: (provedorId: string) =>
    api.post<{ ok: boolean; url: string }>(`/provedores/${provedorId}/atendai/ligar-agendamento`),
  /** Liga o chat interno ao do AtendAI (webhook + equipe cadastrada lá). */
  ligarChat: (provedorId: string) =>
    api.post<{ ok: boolean; url: string; colaboradores: number }>(`/provedores/${provedorId}/atendai/ligar-chat`),
};

/** A chave da API de agendamento: só o que a tela pode ver. */
export interface ChaveParceiroPublic {
  prefixo: string;
  rotulo: string | null;
  usoEm: string | null;
  criadoEm: string;
}

export const chaveParceiroApi = {
  obter: (provedorId: string) => api.get<ChaveParceiroPublic | null>(`/provedores/${provedorId}/chave-parceiro`),
  /** Devolve a chave em claro — a ÚNICA vez em que ela existe fora do hash. Regerar mata a anterior. */
  gerar: (provedorId: string, rotulo?: string) =>
    api.post<{ chave: string }>(`/provedores/${provedorId}/chave-parceiro`, rotulo ? { rotulo } : {}),
  revogar: (provedorId: string) => api.delete<void>(`/provedores/${provedorId}/chave-parceiro`),
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

export type FuncaoCampo = "tecnico" | "auxiliar";

export interface TecnicoIsphubResumo {
  id: string;
  nome: string;
  funcaoCampo: FuncaoCampo | null;
  ativo: boolean;
}

export type PapelSgp = "tecnico" | "atendente";

export interface TecnicoSgpItem {
  id: string;
  papel: PapelSgp;
  sgpId: string;
  nome: string | null;
  username: string | null;
  ignorado: boolean;
  usuario: TecnicoIsphubResumo | null;
  /** Técnico: OS abertas em que o login é responsável ou apoio no SGP. Atendente: OS registradas em 60 dias. */
  os: number;
}

export const tecnicosSgpApi = {
  listar: (provedorId: string, papel: PapelSgp = "tecnico") =>
    api.get<{ itens: TecnicoSgpItem[]; tecnicos: TecnicoIsphubResumo[] }>(`/provedores/${provedorId}/tecnicos-sgp?papel=${papel}`),
  sincronizar: (provedorId: string, papel: PapelSgp = "tecnico") =>
    api.post<{ total: number; novos: number; vinculadosAutomaticamente: number }>(
      `/provedores/${provedorId}/tecnicos-sgp/sincronizar?papel=${papel}`,
    ),
  decidir: (
    provedorId: string,
    id: string,
    d: Partial<{ usuarioId: string | null; criar: boolean; ignorado: boolean; funcao: FuncaoCampo | null }>,
  ) => api.patch<TecnicoSgpItem>(`/provedores/${provedorId}/tecnicos-sgp/${id}`, d),
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
