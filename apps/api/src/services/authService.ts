import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PermissoesGestor, UserRole } from "@isphub/shared";
import { env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";
import { MIMES_FOTO } from "./chatService.js";

/** Avatar so e exibido pequeno/circular — bem menor que o teto de anexo do chat (400KB). */
export const LIMITE_AVATAR_BYTES = 200 * 1024;

/** Valida e decodifica uma foto de perfil (base64) — mesmas regras de mime do anexo de chat, teto menor. */
export function validarFotoPerfil(fotoBase64: string, fotoMime: string): Buffer {
  if (!MIMES_FOTO.includes(fotoMime)) throw new HttpError(400, "Formato de foto nao suportado");
  const dados = Buffer.from(fotoBase64, "base64");
  if (dados.byteLength === 0) throw new HttpError(400, "Foto vazia");
  if (dados.byteLength > LIMITE_AVATAR_BYTES) throw new HttpError(400, `Foto maior que ${LIMITE_AVATAR_BYTES / 1024}KB`);
  return dados;
}

const SALT_ROUNDS = 12;

export interface JwtPayload {
  sub: string; // usuario.id
  email: string;
  role: UserRole;
  provedorId: string | null;
  /**
   * Versao da sessao (Usuario.tokenVersion no momento da emissao). Comparada
   * pelo requireAuth com o valor atual do banco — e o que permite invalidar um
   * token ja emitido. Opcional so pra nao quebrar tokens emitidos antes desta
   * mudanca: ausente e tratado como 0, que e o default da coluna.
   */
  tv?: number;
  /**
   * So GESTOR: provedores que ele alcanca (vazio/ausente = todos). Nunca vem
   * do token: o requireAuth preenche do banco.
   */
  provedores?: string[];
  /** So GESTOR: areas e niveis (null = total). Nunca vem do token: o requireAuth preenche do banco. */
  permissoes?: PermissoesGestor | null;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
}
