import { useMutation } from "@tanstack/react-query";
import type { DetalhesTecnicos } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * Consulta ao vivo (sob demanda, botao) status de conexao + sinal optico da
 * ONU no SGP do provedor. Mesmo padrao do web (components/ConexaoStatus.tsx):
 * NAO roda automatico por item da lista — uma tela com dezenas de OS
 * disparando isso tudo de uma vez rajaria o SGP do provedor a toa.
 */
export function useVerificarConexao(provedorId: string) {
  const { token } = useAuth();
  return useMutation({
    mutationFn: (contratoId: string) =>
      apiFetch<DetalhesTecnicos>(`/provedores/${provedorId}/conexao/${encodeURIComponent(contratoId)}/detalhes`, { token }),
  });
}
