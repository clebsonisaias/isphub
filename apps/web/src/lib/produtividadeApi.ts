import type { BiProdutividade } from "@isphub/shared";
import { api } from "@/lib/apiClient";

/** Cliente do BI de produtividade — `/produtividade/bi`, ADMIN e GESTOR. */
export const produtividadeApi = {
  bi: (de: string, ate: string, provedorId?: string) => {
    const p = new URLSearchParams({ de, ate });
    if (provedorId) p.set("provedorId", provedorId);
    return api.get<BiProdutividade>(`/produtividade/bi?${p.toString()}`);
  },
};
