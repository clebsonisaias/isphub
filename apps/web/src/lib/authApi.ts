import type { StatusPreset, UsuarioPublic } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export interface AtualizarPerfilInput {
  nomeExibicao?: string | null;
  bio?: string | null;
  telefoneContato?: string | null;
  assinaturaChat?: string | null;
  corDestaque?: string | null;
}

export const authApi = {
  trocarSenha: (senhaAtual: string, novaSenha: string) => api.post<void>("/auth/senha", { senhaAtual, novaSenha }),
  enviarFoto: (fotoBase64: string, fotoMime: string) => api.patch<UsuarioPublic>("/auth/foto", { fotoBase64, fotoMime }),
  removerFoto: () => api.delete<UsuarioPublic>("/auth/foto"),
  atualizarStatus: (status: StatusPreset | null, statusTexto: string | null) =>
    api.patch<UsuarioPublic>("/auth/status", { status, statusTexto }),
  atualizarPerfil: (dados: AtualizarPerfilInput) => api.patch<UsuarioPublic>("/auth/perfil", dados),
};
