import { api } from "@/lib/apiClient";

/** Hora de rede de Natal/RN (proxy do backend, ver apps/api/src/routes/hora.ts). */
export interface HoraRede {
  isoUtc: string;
  timezone: string;
  cidade: string;
  fonte: "rede" | "servidor";
}

export const horaApi = {
  obter: () => api.get<HoraRede>("/hora"),
};
