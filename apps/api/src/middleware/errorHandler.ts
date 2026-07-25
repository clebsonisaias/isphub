import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

/** Erro de negocio com status HTTP explicito (lancado pelos handlers/services). */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Middleware de erro central: normaliza excecoes em respostas JSON consistentes. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Dados invalidos", detalhes: err.flatten() });
  }
  console.error(err);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

/** Envolve handlers async para propagar rejeicoes ao errorHandler. */
export function asyncHandler<T extends (...args: any[]) => Promise<any>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
