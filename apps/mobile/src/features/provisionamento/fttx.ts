import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Olt,
  OnuAutorizada,
  OnuNaoAutorizada,
  OnuTemplate,
  ProvisionarOnuInput,
  ProvisionarOnuResultado,
} from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * Camada de dados do provisionamento FTTX. O app e CLIENTE da API ISPhub —
 * nunca fala com o SGP direto. Tudo passa por /provedores/:id/fttx/... (a API
 * escolhe o conector do provedor e redige segredos).
 */
const base = (provedorId: string) => `/provedores/${provedorId}/fttx`;

export type OnuStatus = "nao-autorizadas" | "autorizadas";

export const fttxKeys = {
  olts: (provedorId: string) => ["fttx", "olts", provedorId] as const,
  onus: (provedorId: string, oltId: string, status: OnuStatus, busca?: string) =>
    ["fttx", "onus", provedorId, oltId, status, busca ?? ""] as const,
  templates: (provedorId: string, oltId: string) => ["fttx", "templates", provedorId, oltId] as const,
};

export function listarOlts(provedorId: string, token: string | null) {
  return apiFetch<Olt[]>(`${base(provedorId)}/olts`, { token });
}

export function listarOnus(provedorId: string, oltId: string, status: OnuStatus, token: string | null, contrato?: string) {
  const qs = new URLSearchParams({ status });
  if (contrato) qs.set("contrato", contrato);
  return apiFetch<OnuNaoAutorizada[] | OnuAutorizada[]>(`${base(provedorId)}/olts/${oltId}/onus?${qs.toString()}`, { token });
}

export function listarTemplates(provedorId: string, oltId: string, token: string | null) {
  return apiFetch<OnuTemplate[]>(`${base(provedorId)}/olts/${oltId}/templates`, { token });
}

/**
 * Escritas de rede (autorizar/desautorizar). Ao concluir, invalida as duas abas
 * de ONU daquela OLT — a nao-autorizada some da lista, a autorizada aparece.
 */
export function useProvisionar(provedorId: string, oltId: string) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: ["fttx", "onus", provedorId, oltId] });

  const autorizar = useMutation({
    mutationFn: (dados: ProvisionarOnuInput) =>
      apiFetch<ProvisionarOnuResultado>(`${base(provedorId)}/olts/${oltId}/onus/autorizar`, {
        method: "POST",
        token,
        body: dados,
      }),
    onSuccess: invalidar,
  });

  const desautorizar = useMutation({
    mutationFn: (onuId: string) =>
      apiFetch<{ ok: boolean; mensagem: string | null }>(`${base(provedorId)}/onus/${onuId}/desautorizar`, {
        method: "POST",
        token,
      }),
    onSuccess: invalidar,
  });

  return { autorizar, desautorizar };
}
