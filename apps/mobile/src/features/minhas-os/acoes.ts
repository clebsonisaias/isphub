import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OsStatus } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * Acoes de write-back da OS (via API ISPhub — nunca direto no SGP). Toda mutation
 * invalida o detalhe e a fila pra refletir na hora. Concluir manda status
 * `concluida`; a API cuida do `os_data_finalizacao` no SGP.
 */
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
  });

  const mudarStatus = useMutation({
    mutationFn: (status: OsStatus) =>
      apiFetch<void>(`/ordens-servico/${osId}/status`, { method: "PATCH", token, body: { status } }),
    onSuccess: aoMudar,
  });

  const anotar = useMutation({
    mutationFn: (texto: string) =>
      apiFetch<void>(`/ordens-servico/${osId}/anotacoes`, { method: "POST", token, body: { texto } }),
    onSuccess: aoMudar,
  });

  return { marcarACaminho, mudarStatus, anotar };
}
