import type { DashboardMetrics, TecnicoEmJornada } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const dashboardApi = {
  metrics: () => api.get<DashboardMetrics>("/dashboard/metrics"),
  /** Quem esta em servico agora — restrito a ADMIN/GESTOR na API. */
  emJornada: () => api.get<TecnicoEmJornada[]>("/jornada/ativas"),
};
