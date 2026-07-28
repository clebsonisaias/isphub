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
  // Erros que ja carregam status HTTP proprio e nao sao nossos — na pratica os
  // do body-parser (corpo acima do limite, JSON malformado). Sem este ramo eles
  // caiam no 500 generico: quem mandava uma foto grande demais recebia "Erro
  // interno do servidor" em vez de saber que o arquivo passou do tamanho.
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const tipo = (err as { type?: string })?.type;
    if (tipo === "entity.too.large") {
      return res.status(413).json({ error: "Conteudo grande demais para esta rota" });
    }
    if (tipo === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON invalido" });
    }
    return res.status(status).json({ error: "Requisicao invalida" });
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
