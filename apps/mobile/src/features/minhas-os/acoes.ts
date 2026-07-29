import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";
import type { OsStatus } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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

  const marcarACaminho = useMutation({
    mutationFn: () => apiFetch<void>(`/ordens-servico/${osId}/acaminho`, { method: "POST", token }),
    onSuccess: aoMudar,
    onError: avisarFalha("marcar a caminho"),
  });

  const mudarStatus = useMutation({
    mutationFn: (status: OsStatus) =>
      apiFetch<void>(`/ordens-servico/${osId}/status`, { method: "PATCH", token, body: { status } }),
    onSuccess: aoMudar,
    onError: avisarFalha("mudar o status da OS"),
  });

  const anotar = useMutation({
    mutationFn: (texto: string) =>
      apiFetch<void>(`/ordens-servico/${osId}/anotacoes`, { method: "POST", token, body: { texto } }),
    onSuccess: aoMudar,
    onError: avisarFalha("salvar a anotação"),
  });

  return { marcarACaminho, mudarStatus, anotar };
}
