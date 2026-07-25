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
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
