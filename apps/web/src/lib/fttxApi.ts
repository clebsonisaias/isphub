import type {
  Olt,
  OnuAutorizada,
  OnuNaoAutorizada,
  OnuTemplate,
  ProvisionarOnuInput,
  ProvisionarOnuResultado,
} from "@isphub/shared";
import { api } from "@/lib/apiClient";

/**
 * Provisionamento FTTX por provedor. O web é cliente da API ISPhub — nunca fala
 * com o SGP direto. Cada provedor tem o seu SGP, com as suas OLTs.
 */
const base = (provedorId: string) => `/provedores/${provedorId}/fttx`;

export const fttxApi = {
  olts: (provedorId: string) => api.get<Olt[]>(`${base(provedorId)}/olts`),
  onusNaoAutorizadas: (provedorId: string, oltId: string) =>
    api.get<OnuNaoAutorizada[]>(`${base(provedorId)}/olts/${oltId}/onus?status=nao-autorizadas`),
  onusAutorizadas: (provedorId: string, oltId: string, contrato?: string) =>
    api.get<OnuAutorizada[]>(
      `${base(provedorId)}/olts/${oltId}/onus?status=autorizadas${contrato ? `&contrato=${encodeURIComponent(contrato)}` : ""}`,
    ),
  templates: (provedorId: string, oltId: string) => api.get<OnuTemplate[]>(`${base(provedorId)}/olts/${oltId}/templates`),
  autorizar: (provedorId: string, oltId: string, dados: ProvisionarOnuInput) =>
    api.post<ProvisionarOnuResultado>(`${base(provedorId)}/olts/${oltId}/onus/autorizar`, dados),
  desautorizar: (provedorId: string, onuId: string) =>
    api.post<{ ok: boolean; mensagem: string | null }>(`${base(provedorId)}/onus/${onuId}/desautorizar`),
};
