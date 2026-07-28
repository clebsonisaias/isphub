import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { UserRole } from "@isphub/shared";
import { env } from "../config/env.js";

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
