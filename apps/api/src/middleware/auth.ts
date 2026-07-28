import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@isphub/shared";
import { verifyToken, type JwtPayload } from "../services/authService.js";
import { obterEstadoSessao } from "../services/sessaoService.js";
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

/**
 * Exige um Bearer token valido; popula req.user.
 *
 * Alem de conferir a assinatura, confere se a SESSAO ainda vale: usuario ativo
 * e `tokenVersion` igual a do banco (ver sessaoService). Sem essa segunda
 * parte, o token era um cheque em branco de 8h — desativar alguem, trocar a
 * senha dele ou rebaixar o papel nao surtia efeito nenhum ate expirar.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new HttpError(401, "Token de autenticacao ausente"));
  }
  const token = header.slice("Bearer ".length);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(new HttpError(401, "Token invalido ou expirado"));
  }

  try {
    const sessao = await obterEstadoSessao(payload.sub);
    if (!sessao || !sessao.ativo) {
      return next(new HttpError(401, "Usuario nao encontrado ou inativo"));
    }
    // `tv` ausente = token emitido antes desta mudanca; vale contra a versao 0.
    if ((payload.tv ?? 0) !== sessao.tokenVersion) {
      return next(new HttpError(401, "Sessao encerrada. Entre novamente."));
    }
  } catch (err) {
    return next(err);
  }

  req.user = payload;
  tocarPresenca(payload.sub);
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

