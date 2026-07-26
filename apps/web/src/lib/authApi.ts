import { api } from "@/lib/apiClient";

export const authApi = {
  trocarSenha: (senhaAtual: string, novaSenha: string) => api.post<void>("/auth/senha", { senhaAtual, novaSenha }),
};
