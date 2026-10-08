import type { DashboardAgenda, DashboardMetrics, TecnicoEmJornada } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const dashboardApi = {
  metrics: () => api.get<DashboardMetrics>("/dashboard/metrics"),
  /** Quem esta em servico agora — restrito a ADMIN/GESTOR na API. */
  emJornada: () => api.get<TecnicoEmJornada[]>("/jornada/ativas"),
  /** Ocupacao da semana, pendencias e marcacoes por funcionario (ADMIN/GESTOR). */
  agenda: (dias = 30) => api.get<DashboardAgenda>(`/dashboard/agenda?dias=${dias}`),
};
