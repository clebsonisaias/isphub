import type {
  ConversaClienteResumo,
  FiltroConversaCliente,
  IniciarConversaClienteInput,
  MensagemClienteDTO,
  TemplateWhatsappDTO,
} from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const clientesChatApi = {
  conversas: (filtro: FiltroConversaCliente) => api.get<ConversaClienteResumo[]>(`/chat-clientes/conversas?filtro=${filtro}`),
  mensagens: (conversaId: string) => api.get<MensagemClienteDTO[]>(`/chat-clientes/conversas/${conversaId}/mensagens`),
  enviar: (conversaId: string, corpo: string) => api.post<MensagemClienteDTO>(`/chat-clientes/conversas/${conversaId}/mensagens`, { corpo }),
  assumir: (conversaId: string) => api.post<void>(`/chat-clientes/conversas/${conversaId}/assumir`),
  transferir: (conversaId: string, agenteId: string) => api.post<void>(`/chat-clientes/conversas/${conversaId}/transferir`, { agenteId }),
  encerrar: (conversaId: string) => api.post<void>(`/chat-clientes/conversas/${conversaId}/encerrar`),
  /** Catálogo lido ao vivo da Meta — pode falhar por config (WABA ID) e a mensagem do erro é acionável, mostre-a. */
  templates: () => api.get<TemplateWhatsappDTO[]>("/chat-clientes/templates"),
  iniciar: (input: IniciarConversaClienteInput) => api.post<ConversaClienteResumo>("/chat-clientes/conversas", input),
};
