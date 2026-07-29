import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import type { ConversaClienteResumo, MensagemClienteDTO } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export type FiltroConversaCliente = "fila" | "minhas";

export function useConversasClientes(filtro: FiltroConversaCliente) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["cliente-chat", "conversas", filtro],
    enabled: !!token,
    queryFn: () => apiFetch<ConversaClienteResumo[]>(`/chat-clientes/conversas?filtro=${filtro}`, { token }),
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
