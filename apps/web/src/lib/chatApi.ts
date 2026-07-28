import type {
  ContatoChat,
  ConversaResumo,
  Mensagem,
  MensagemTipo,
} from "@isphub/shared";
import { api } from "@/lib/apiClient";

export interface EnviarMensagemInput {
  tipo: MensagemTipo;
  corpo?: string;
  anexoBase64?: string;
  anexoMime?: string;
  duracaoSeg?: number;
  lat?: number;
  lng?: number;
  ordemServicoRefId?: string;
  respondendoAId?: string;
}

export type RespostaRapidaTipo =
  "a_caminho" | "cheguei" | "cliente_ausente" | "preciso_apoio";

function query(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const chatApi = {
  contatos: () => api.get<ContatoChat[]>("/chat/contatos"),
  conversas: () => api.get<ConversaResumo[]>("/chat/conversas"),
  naoLidas: () => api.get<{ naoLidas: number }>("/chat/nao-lidas"),

  criarDireta: (usuarioId: string) =>
    api.post<ConversaResumo>("/chat/conversas/direta", { usuarioId }),
  criarGrupo: (titulo: string, participanteIds: string[]) =>
    api.post<ConversaResumo>("/chat/conversas/grupo", {
      titulo,
      participanteIds,
    }),
  garantirConversaDeOs: (ordemServicoId: string) =>
    api.post<ConversaResumo>(`/chat/conversas/os/${ordemServicoId}`),
  garantirAvisos: () => api.post<ConversaResumo>("/chat/conversas/avisos"),

  mensagens: (
    conversaId: string,
    opts?: { antesDe?: string; limit?: number },
  ) =>
    api.get<Mensagem[]>(
      `/chat/conversas/${conversaId}/mensagens${query({ antesDe: opts?.antesDe, limit: opts?.limit })}`,
    ),
  enviar: (conversaId: string, input: EnviarMensagemInput) =>
    api.post<Mensagem>(`/chat/conversas/${conversaId}/mensagens`, input),
  marcarLida: (conversaId: string) =>
    api.post<void>(`/chat/conversas/${conversaId}/leitura`),
  digitando: (conversaId: string) =>
    api.post<void>(`/chat/conversas/${conversaId}/digitando`),
  respostaRapida: (conversaId: string, tipo: RespostaRapidaTipo) =>
    api.post<Mensagem>(`/chat/conversas/${conversaId}/os/resposta-rapida`, {
      tipo,
    }),
  reagir: (conversaId: string, mensagemId: string, emoji: string) =>
    api.post<void>(
      `/chat/conversas/${conversaId}/mensagens/${mensagemId}/reagir`,
      { emoji },
    ),
  editar: (conversaId: string, mensagemId: string, corpo: string) =>
    api.patch<Mensagem>(
      `/chat/conversas/${conversaId}/mensagens/${mensagemId}`,
      { corpo },
    ),
  apagar: (conversaId: string, mensagemId: string) =>
    api.delete<void>(`/chat/conversas/${conversaId}/mensagens/${mensagemId}`),

  urlAnexo: (mensagemId: string) => `/chat/mensagens/${mensagemId}/anexo`,
  getAnexoBlob: (mensagemId: string) =>
    api.getBlob(`/chat/mensagens/${mensagemId}/anexo`),
};
