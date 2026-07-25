import type { ConnectionStatus, DetalhesTecnicos } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const conexaoApi = {
  verificar: (provedorId: string, contratoId: string) =>
    api.get<ConnectionStatus>(`/provedores/${provedorId}/conexao/${encodeURIComponent(contratoId)}`),
  detalhes: (provedorId: string, contratoId: string) =>
    api.get<DetalhesTecnicos>(`/provedores/${provedorId}/conexao/${encodeURIComponent(contratoId)}/detalhes`),
};
