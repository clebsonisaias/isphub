import type { Notificacao } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const notificacoesApi = {
  contagem: () => api.get<{ naoLidas: number }>("/notificacoes/contagem"),
  listar: () => api.get<Notificacao[]>("/notificacoes"),
  marcarLida: (id: string) => api.post<void>(`/notificacoes/${id}/lida`),
  marcarTodasLidas: () => api.post<void>("/notificacoes/marcar-todas-lidas"),
};
