import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errorHandler.js";
import { provedorDaChave } from "../services/chaveParceiroService.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Provedor dono da chave de parceiro. So existe sob `requireChaveParceiro`. */
      provedorParceiroId?: string;
    }
  }
}

/**
 * Autentica um sistema PARCEIRO por chave (Bearer isk_...).
 *
 * Diferente de `requireAuth`: nao ha usuario, nao ha papel, e o escopo nao vem
 * do token — vem da chave. Uma chave pertence a UM provedor, e e isso que faz
 * a garantia valer sem depender de o parceiro mandar o `provedorId` certo: as
 * rotas leem `req.provedorParceiroId` e ignoram o que vier no corpo.
 */
export async function requireChaveParceiro(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new HttpError(401, "Chave de parceiro ausente"));
  }
  try {
    const provedorId = await provedorDaChave(header.slice("Bearer ".length));
    if (!provedorId) return next(new HttpError(401, "Chave de parceiro invalida"));
    req.provedorParceiroId = provedorId;
    next();
  } catch (e) {
    next(e);
  }
}
