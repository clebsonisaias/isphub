import { useMemo, useRef } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, useMutation, type InfiniteData } from "@tanstack/react-query";
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

/** Quantas mensagens por pagina — mesmo default do servidor. */
const MENSAGENS_POR_PAGINA = 30;

/**
 * Mensagens da conversa, paginadas por cursor (mais recentes primeiro).
 *
 * Antes isto era um `useQuery` simples que nunca mandava `antesDe`: o servidor
 * aplicava o limite padrao de 30 e a tela nao tinha como pedir mais — uma
 * conversa com historico simplesmente NAO podia ser lida por inteiro, mesmo
 * com a API suportando cursor desde sempre. Agora e infinite query, e a tela
 * puxa a proxima pagina ao chegar no topo (lista `inverted`).
 *
 * `flat` sai na ordem do servidor (mais nova primeiro), que e exatamente a
 * ordem que um FlatList `inverted` espera — sem `.reverse()` a cada render.
 */
export function useMensagens(conversaId: string) {
  const { token } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ["chat", "mensagens", conversaId],
    enabled: !!token && !!conversaId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(MENSAGENS_POR_PAGINA) });
      if (pageParam) qs.set("antesDe", pageParam);
      return apiFetch<Mensagem[]>(`/chat/conversas/${conversaId}/mensagens?${qs.toString()}`, { token });
    },
    // Pagina menor que o limite = acabou o historico. Senao, o cursor e o
    // criadoEm da mensagem mais antiga que veio (a ultima da pagina).
    getNextPageParam: (ultimaPagina) =>
      ultimaPagina.length < MENSAGENS_POR_PAGINA ? undefined : ultimaPagina[ultimaPagina.length - 1]?.criadoEm,
  });

  const mensagens = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  return { ...query, mensagens };
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
  const { token, usuario } = useAuth();
  const qc = useQueryClient();
  const aoMudar = () => {
    qc.invalidateQueries({ queryKey: ["chat", "mensagens", conversaId] });
    qc.invalidateQueries({ queryKey: ["chat", "conversas"] });
    qc.invalidateQueries({ queryKey: ["chat", "nao-lidas"] });
  };

  /**
   * Envio OTIMISTA: a bolha aparece na hora, antes da resposta do servidor.
   *
   * Antes o fluxo era enviar -> invalidar -> refetch, e so entao a mensagem
   * surgia. Como o composer limpa a caixa assim que voce toca em enviar, num
   * 3G de campo o texto sumia e nada aparecia por segundos — parecia que a
   * mensagem tinha se perdido, e o tecnico mandava de novo. O outbox cobria
   * "sem rede"; nao cobria "rede ruim", que e o caso comum.
   *
   * Em erro, desfaz (rollback) — inclusive quando o handler da tela decide
   * mandar pra fila offline.
   */
  const enviar = useMutation({
    mutationFn: (input: EnviarMensagemInput) =>
      apiFetch<Mensagem>(`/chat/conversas/${conversaId}/mensagens`, { method: "POST", token, body: input }),

    onMutate: async (input: EnviarMensagemInput) => {
      const chave = ["chat", "mensagens", conversaId];
      await qc.cancelQueries({ queryKey: chave });
      const anterior = qc.getQueryData<InfiniteData<Mensagem[]>>(chave);

      const otimista: Mensagem = {
        id: `otimista-${Date.now()}`,
        conversaId,
        autor: usuario ? { usuarioId: usuario.id, nome: usuario.nome, role: usuario.role, online: true, ultimaAtividadeEm: null } : null,
        tipo: input.tipo,
        corpo: input.corpo ?? null,
        anexoMime: input.anexoMime ?? null,
        anexoTamanho: null,
        duracaoSeg: input.duracaoSeg ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        ordemServicoId: input.ordemServicoRefId ?? null,
        respondendoA: null,
        reacoes: [],
        criadoEm: new Date().toISOString(),
      };

      // As paginas vem mais-nova-primeiro, entao a nova entra no inicio da
      // primeira pagina (que e o fim visual da lista `inverted`).
      qc.setQueryData<InfiniteData<Mensagem[]>>(chave, (atual) =>
        atual
          ? { ...atual, pages: [[otimista, ...(atual.pages[0] ?? [])], ...atual.pages.slice(1)] }
          : { pages: [[otimista]], pageParams: [undefined] },
      );

      return { anterior };
    },

    onError: (_err, _input, ctx) => {
      if (ctx?.anterior) qc.setQueryData(["chat", "mensagens", conversaId], ctx.anterior);
    },

    // Sempre reconcilia com o servidor: a bolha otimista some e entra a real
    // (com id de verdade, para reagir/responder/apagar funcionarem).
    onSettled: aoMudar,
  });

  const marcarLida = useMutation({
    mutationFn: () => apiFetch<void>(`/chat/conversas/${conversaId}/leitura`, { method: "POST", token }),
    onSuccess: aoMudar,
  });

  /**
   * "Estou digitando" e sinal efemero, nao um evento por tecla.
   *
   * Antes o composer chamava isto em CADA `onChangeText`: uma mensagem de 40
   * caracteres virava 40 POSTs. Num tecnico em campo com 3G isso e bateria,
   * franquia de dados e latencia queimadas — e o endpoint /digitando e o unico
   * do chat sem rate limit no servidor. O comentario do realtime.ts ja dizia
   * "um evento por debounce de tecla"; o debounce so nao existia.
   *
   * O throttle vive AQUI (e nao na tela) pra valer pra qualquer chamador. A
   * janela e menor que os 4s que o outro lado espera antes de apagar o aviso,
   * entao a indicacao continua continua enquanto a pessoa digita.
   */
  const ultimoDigitandoRef = useRef(0);
  const INTERVALO_DIGITANDO_MS = 2500;

  const digitandoMutation = useMutation({
    mutationFn: () => apiFetch<void>(`/chat/conversas/${conversaId}/digitando`, { method: "POST", token }),
  });

  const digitando = useMemo(
    () => ({
      ...digitandoMutation,
      mutate: () => {
        const agora = Date.now();
        if (agora - ultimoDigitandoRef.current < INTERVALO_DIGITANDO_MS) return;
        ultimoDigitandoRef.current = agora;
        digitandoMutation.mutate();
      },
    }),
    [digitandoMutation],
  );

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
