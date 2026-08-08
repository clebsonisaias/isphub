import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";
import type { CodigoStatusContrato, OsStatus } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { obterGeoOuNada } from "@/features/localizacao";

/**
 * Acoes de write-back da OS (via API ISPhub — nunca direto no SGP). Toda mutation
 * invalida o detalhe e a fila pra refletir na hora. Concluir manda status
 * `concluida`; a API cuida do `os_data_finalizacao` no SGP.
 */

/**
 * Sem isto a falha era MUDA: no quintal do cliente, com 3G ruim, o tecnico
 * tocava "Concluir OS", o spinner rodava, parava, e a tela ficava identica —
 * mesmo status, mesmo botao. Ele tocava de novo, e de novo, sem saber se a OS
 * fechou ou se o request morreu. Erro de rede tem que doer na tela.
 */
function avisarFalha(acao: string) {
  return (erro: unknown) => {
    const detalhe = erro instanceof Error ? erro.message : "Verifique a conexão e tente de novo.";
    Alert.alert(`Não foi possível ${acao}`, detalhe);
  };
}

export function useAcoesOs(osId: string) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const aoMudar = () => {
    qc.invalidateQueries({ queryKey: ["os", osId] });
    qc.invalidateQueries({ queryKey: ["fila"] });
  };

  /*
   * As acoes de campo carimbam ONDE o tecnico estava — vira a trilha da OS
   * (de onde saiu, de onde chegou, de onde concluiu). Best-effort: sem
   * permissao ou sem sinal, a acao acontece do mesmo jeito, com posicao nula.
   */
  const marcarACaminho = useMutation({
    mutationFn: async () =>
      apiFetch<void>(`/ordens-servico/${osId}/acaminho`, {
        method: "POST",
        token,
        body: (await obterGeoOuNada()) ?? {},
      }),
    onSuccess: aoMudar,
    onError: avisarFalha("marcar a caminho"),
  });

  const mudarStatus = useMutation({
    mutationFn: async (status: OsStatus) =>
      apiFetch<void>(`/ordens-servico/${osId}/status`, {
        method: "PATCH",
        token,
        // "Em execucao" = chegou; "Concluida" = terminou. Sao dois dos tres
        // momentos que a trilha registra (o terceiro e o "a caminho" acima).
        body: { status, ...((await obterGeoOuNada()) ?? {}) },
      }),
    onSuccess: aoMudar,
    onError: avisarFalha("mudar o status da OS"),
  });

  const anotar = useMutation({
    mutationFn: (texto: string) =>
      apiFetch<void>(`/ordens-servico/${osId}/anotacoes`, { method: "POST", token, body: { texto } }),
    onSuccess: aoMudar,
    onError: avisarFalha("salvar a anotação"),
  });

  /**
   * Status do CONTRATO (nao o da OS). Pro tecnico so existe uma transicao —
   * Inativo -> Ativo —, e quem decide isso e o servidor: a tela oferece o que
   * `alvosPermitidos` disser, e a API recusa com 403 o que passar.
   */
  const mudarContratoStatus = useMutation({
    mutationFn: (status: CodigoStatusContrato) =>
      apiFetch<void>(`/ordens-servico/${osId}/contrato-status`, { method: "POST", token, body: { status } }),
    onSuccess: aoMudar,
    onError: avisarFalha("mudar o status do contrato"),
  });

  return { marcarACaminho, mudarStatus, anotar, mudarContratoStatus };
}
