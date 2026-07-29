import type { CanalWhatsappConfigInput, CanalWhatsappConfigPublic } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const canaisWhatsappApi = {
  listar: () => api.get<CanalWhatsappConfigPublic[]>("/admin/canais-whatsapp"),
  salvar: (tipo: "meta" | "evolution", data: CanalWhatsappConfigInput) =>
    api.put<CanalWhatsappConfigPublic>(`/admin/canais-whatsapp/${tipo}`, data),
  testar: (tipo: "meta" | "evolution") => api.post<{ ok: boolean; message?: string }>(`/admin/canais-whatsapp/${tipo}/testar`),
};
