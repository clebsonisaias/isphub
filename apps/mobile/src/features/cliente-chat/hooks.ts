import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  UserRole,
  type ConversaClienteResumo,
  type FiltroConversaCliente,
  type IniciarConversaClienteInput,
  type MensagemClienteDTO,
  type TemplateWhatsappDTO,
} from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * ADMIN/GESTOR veem todas as conversas e podem intervir na de outro atendente;
 * TECNICO so recebe do servidor as que ele mesmo iniciou. O escopo de verdade e
 * server-side — isto aqui existe so pra UI nao oferecer aba, botao ou texto que
 * voltaria vazio (ou 403) pro tecnico.
 */
export function usePodeSupervisionar(): boolean {
  const { usuario } = useAuth();
  return usuario?.role === UserRole.ADMIN || usuario?.role === UserRole.GESTOR;
}

export function useConversasClientes(filtro: FiltroConversaCliente) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["cliente-chat", "conversas", filtro],
    enabled: !!token,
    queryFn: () => apiFetch<ConversaClienteResumo[]>(`/chat-clientes/conversas?filtro=${filtro}`, { token }),
  });
}

/**
 * Catalogo de modelos HSM aprovados, lido ao vivo da Meta pelo servidor (que ja
 * cacheia por 5 min). O staleTime espelha esse cache pra abrir a tela de novo
 * nao gerar outra ida ate a Graph API.
 */
export function useTemplatesWhatsapp() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["cliente-chat", "templates"],
    enabled: !!token,
    staleTime: 5 * 60_000,
    queryFn: () => apiFetch<TemplateWhatsappDTO[]>("/chat-clientes/templates", { token }),
  });
}

/** Dispara o template e abre a conversa — unico jeito de falar com quem nao escreveu primeiro. */
export function useIniciarConversaCliente() {
  const { token } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IniciarConversaClienteInput) =>
      apiFetch<ConversaClienteResumo>("/chat-clientes/conversas", { method: "POST", token, body: input }),
    // A conversa nova aparece em mais de uma aba (minhas/todas) — invalida o prefixo inteiro.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cliente-chat", "conversas"] }),
  });
}

export function useMensagensCliente(conversaId: string) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["cliente-chat", "mensagens", conversaId],
    enabled: !!token && !!conversaId,
    queryFn: () => apiFetch<MensagemClienteDTO[]>(`/chat-clientes/conversas/${conversaId}/mensagens`, { token }),
    refetchInterval: 5000, // sem SSE dedicado nesta tela ainda — poll curto cobre enquanto a thread esta aberta
  });
}

export function useEnviarMensagemCliente(conversaId: string) {
  const { token } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: string) =>
      apiFetch<MensagemClienteDTO>(`/chat-clientes/conversas/${conversaId}/mensagens`, { method: "POST", token, body: { corpo } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cliente-chat", "mensagens", conversaId] });
      void qc.invalidateQueries({ queryKey: ["cliente-chat", "conversas"] });
    },
  });
}

export function useAssumirConversaCliente() {
  const { token } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversaId: string) => apiFetch<void>(`/chat-clientes/conversas/${conversaId}/assumir`, { method: "POST", token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cliente-chat", "conversas"] }),
  });
}

export function useEncerrarConversaCliente() {
  const { token } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversaId: string) => apiFetch<void>(`/chat-clientes/conversas/${conversaId}/encerrar`, { method: "POST", token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cliente-chat", "conversas"] }),
  });
}
