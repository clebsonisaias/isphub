import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import type { ContatoChat, ConversaResumo, Mensagem, MensagemTipo } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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

export type RespostaRapidaTipo = "a_caminho" | "cheguei" | "cliente_ausente" | "preciso_apoio";

/** Caminho do anexo — usado com baixarAnexoAutenticado (foto/audio) e nao com <Image src>/player direto. */
export function urlAnexo(mensagemId: string): string {
  return `/chat/mensagens/${mensagemId}/anexo`;
}

export function useConversas() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["chat", "conversas"],
    enabled: !!token,
    queryFn: () => apiFetch<ConversaResumo[]>("/chat/conversas", { token }),
  });
}

export function useNaoLidas() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["chat", "nao-lidas"],
    enabled: !!token,
    queryFn: () => apiFetch<{ naoLidas: number }>("/chat/nao-lidas", { token }),
  });
}

export function useContatos() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["chat", "contatos"],
    enabled: !!token,
    queryFn: () => apiFetch<ContatoChat[]>("/chat/contatos", { token }),
  });
}

export function useMensagens(conversaId: string) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["chat", "mensagens", conversaId],
    enabled: !!token && !!conversaId,
    queryFn: () => apiFetch<Mensagem[]>(`/chat/conversas/${conversaId}/mensagens`, { token }),
  });
}

/** Cria/abre conversas (DM, grupo, thread de OS, Avisos) — usado na tela de "Nova conversa" e no botao de OS. */
export function useCriarConversa() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const aoCriar = () => qc.invalidateQueries({ queryKey: ["chat", "conversas"] });

  const criarDireta = useMutation({
    mutationFn: (usuarioId: string) => apiFetch<ConversaResumo>("/chat/conversas/direta", { method: "POST", token, body: { usuarioId } }),
    onSuccess: aoCriar,
  });
  const criarGrupo = useMutation({
    mutationFn: (input: { titulo: string; participanteIds: string[] }) =>
      apiFetch<ConversaResumo>("/chat/conversas/grupo", { method: "POST", token, body: input }),
    onSuccess: aoCriar,
  });
  const garantirConversaDeOs = useMutation({
    mutationFn: (ordemServicoId: string) => apiFetch<ConversaResumo>(`/chat/conversas/os/${ordemServicoId}`, { method: "POST", token }),
    onSuccess: aoCriar,
  });
  const garantirAvisos = useMutation({
    mutationFn: () => apiFetch<ConversaResumo>("/chat/conversas/avisos", { method: "POST", token }),
    onSuccess: aoCriar,
  });

  return { criarDireta, criarGrupo, garantirConversaDeOs, garantirAvisos };
}

/** Acoes dentro de uma conversa aberta — mesmo padrao de useAcoesOs (uma useMutation por acao). */
export function useAcoesChat(conversaId: string) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const aoMudar = () => {
    qc.invalidateQueries({ queryKey: ["chat", "mensagens", conversaId] });
    qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
    qc.invalidateQueries({ queryKey: ["chat", "nao-lidas"] });
  };

  const enviar = useMutation({
    mutationFn: (input: EnviarMensagemInput) =>
      apiFetch<Mensagem>(`/chat/conversas/${conversaId}/mensagens`, { method: "POST", token, body: input }),
    onSuccess: aoMudar,
  });

  const marcarLida = useMutation({
    mutationFn: () => apiFetch<void>(`/chat/conversas/${conversaId}/leitura`, { method: "POST", token }),
    onSuccess: aoMudar,
  });

  const digitando = useMutation({
    mutationFn: () => apiFetch<void>(`/chat/conversas/${conversaId}/digitando`, { method: "POST", token }),
  });

  const respostaRapida = useMutation({
    mutationFn: (tipo: RespostaRapidaTipo) =>
      apiFetch<Mensagem>(`/chat/conversas/${conversaId}/os/resposta-rapida`, { method: "POST", token, body: { tipo } }),
    onSuccess: aoMudar,
  });

  const reagir = useMutation({
    mutationFn: ({ mensagemId, emoji }: { mensagemId: string; emoji: string }) =>
      apiFetch<void>(`/chat/conversas/${conversaId}/mensagens/${mensagemId}/reagir`, { method: "POST", token, body: { emoji } }),
    onSuccess: aoMudar,
  });

  const editar = useMutation({
    mutationFn: ({ mensagemId, corpo }: { mensagemId: string; corpo: string }) =>
      apiFetch<Mensagem>(`/chat/conversas/${conversaId}/mensagens/${mensagemId}`, { method: "PATCH", token, body: { corpo } }),
    onSuccess: aoMudar,
  });

  const apagar = useMutation({
    mutationFn: (mensagemId: string) =>
      apiFetch<void>(`/chat/conversas/${conversaId}/mensagens/${mensagemId}`, { method: "DELETE", token }),
    onSuccess: aoMudar,
  });

  return { enviar, marcarLida, digitando, respostaRapida, reagir, editar, apagar };
}
