import type { ConversaClienteResumo, MensagemClienteDTO } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const clientesChatApi = {
  conversas: (filtro: "fila" | "minhas") => api.get<ConversaClienteResumo[]>(`/chat-clientes/conversas?filtro=${filtro}`),
  mensagens: (conversaId: string) => api.get<MensagemClienteDTO[]>(`/chat-clientes/conversas/${conversaId}/mensagens`),
  enviar: (conversaId: string, corpo: string) => api.post<MensagemClienteDTO>(`/chat-clientes/conversas/${conversaId}/mensagens`, { corpo }),
  assumir: (conversaId: string) => api.post<void>(`/chat-clientes/conversas/${conversaId}/assumir`),
  encerrar: (conversaId: string) => api.post<void>(`/chat-clientes/conversas/${conversaId}/encerrar`),
};
