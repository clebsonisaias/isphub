import type { StatusPreset, UsuarioPublic } from "@isphub/shared";
import { apiFetch } from "@/lib/api";

export function enviarFoto(base64: string, mime: string, token: string | null): Promise<UsuarioPublic> {
  return apiFetch<UsuarioPublic>("/auth/foto", { method: "PATCH", body: { fotoBase64: base64, fotoMime: mime }, token });
}

export function removerFoto(token: string | null): Promise<UsuarioPublic> {
  return apiFetch<UsuarioPublic>("/auth/foto", { method: "DELETE", token });
}

export function atualizarStatus(status: StatusPreset | null, statusTexto: string, token: string | null): Promise<UsuarioPublic> {
  return apiFetch<UsuarioPublic>("/auth/status", {
    method: "PATCH",
    body: { status, statusTexto: statusTexto.trim() || null },
    token,
  });
}

export interface AtualizarPerfilInput {
  nomeExibicao?: string | null;
  bio?: string | null;
  telefoneContato?: string | null;
  assinaturaChat?: string | null;
  corDestaque?: string | null;
}

export function atualizarPerfil(dados: AtualizarPerfilInput, token: string | null): Promise<UsuarioPublic> {
  return apiFetch<UsuarioPublic>("/auth/perfil", { method: "PATCH", body: dados, token });
}
