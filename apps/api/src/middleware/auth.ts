import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@isphub/shared";
import { verifyToken, type JwtPayload } from "../services/authService.js";
import { HttpError } from "./errorHandler.js";
import { tocarPresenca } from "./presenca.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Exige um Bearer token valido; popula req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Token de autenticacao ausente");
  }
  const token = header.slice("Bearer ".length);
  try {
    req.user = verifyToken(token);
  } catch {
    throw new HttpError(401, "Token invalido ou expirado");
  }
  tocarPresenca(req.user.sub);
  next();
}

/**
 * Exige que o usuario autenticado tenha um dos papeis informados.
 * Deve ser usado depois de requireAuth.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new HttpError(401, "Nao autenticado");
    }
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, "Sem permissao para este recurso");
    }
    next();
  };
}

