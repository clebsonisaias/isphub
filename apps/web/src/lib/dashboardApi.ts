import type { DashboardMetrics } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const dashboardApi = {
  metrics: () => api.get<DashboardMetrics>("/dashboard/metrics"),
};
