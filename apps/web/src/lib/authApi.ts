import type { StatusPreset, UsuarioPublic } from "@isphub/shared";
import { api, setAuthToken } from "@/lib/apiClient";

export interface AtualizarPerfilInput {
  nomeExibicao?: string | null;
  bio?: string | null;
  telefoneContato?: string | null;
  assinaturaChat?: string | null;
  corDestaque?: string | null;
}

export const authApi = {
  /*
   * Trocar a senha DERRUBA as outras sessoes (tokenVersion++ no servidor), e o
   * token guardado aqui fica defasado no mesmo instante. A API devolve um token
   * novo justamente pra este aparelho nao cair junto — e ele estava sendo
   * DESCARTADO (`post<void>`): quem trocava a senha se auto-deslogava, e o
   * sintoma so aparecia na chamada seguinte, como um 401 sem explicacao.
   */
  trocarSenha: async (senhaAtual: string, novaSenha: string) => {
    const { token } = await api.post<{ token: string }>("/auth/senha", { senhaAtual, novaSenha });
    setAuthToken(token);
  },
  enviarFoto: (fotoBase64: string, fotoMime: string) => api.patch<UsuarioPublic>("/auth/foto", { fotoBase64, fotoMime }),
  removerFoto: () => api.delete<UsuarioPublic>("/auth/foto"),
  atualizarStatus: (status: StatusPreset | null, statusTexto: string | null) =>
    api.patch<UsuarioPublic>("/auth/status", { status, statusTexto }),
  atualizarPerfil: (dados: AtualizarPerfilInput) => api.patch<UsuarioPublic>("/auth/perfil", dados),
};
