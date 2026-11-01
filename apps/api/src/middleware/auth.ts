import type { NextFunction, Request, Response } from "express";
import { UserRole } from "@isphub/shared";
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
  if (payload.role === UserRole.ATENDENTE && !atendentePode(req.method, req.originalUrl)) {
    return next(new HttpError(403, "Atendente nao tem acesso a este recurso"));
  }
  if (payload.role === UserRole.VENDEDOR && !vendedorPode(req.method, req.originalUrl)) {
    return next(new HttpError(403, "Vendedor nao tem acesso a este recurso"));
  }
  tocarPresenca(payload.sub);
  next();
}

/**
 * O que o ATENDENTE alcanca — negacao por padrao. Ele ve a fila e as OS do
 * proprio provedor (o escopo fica em escopoService) e marca/desmarca visita;
 * qualquer rota nova fica FECHADA pra ele ate entrar aqui. A checagem fina
 * (so o proprio provedor) continua nas rotas.
 */
const PERMITIDO_ATENDENTE: [RegExp, RegExp][] = [
  [/./, /^\/auth(\/|$)/],
  [/./, /^\/notificacoes(\/|$)/],
  [/^GET$/, /^\/(fila|hora|eventos|config|categorias)(\/|$)/],
  [/^GET$/, /^\/provedores(\/[^/]+)?$/],
  [/^GET$/, /^\/ordens-servico\/[^/]+(\/(ficha-sgp|eventos))?$/],
  [/^GET$/, /^\/agenda\/(vagas|proximas|turno|minhas)$/],
  [/^POST$/, /^\/agenda\/?$/],
  [/^DELETE$/, /^\/agenda\/[^/]+$/],
  // Conversa com o cliente da OS pelo AtendAI e encerrar OS sem visita (limitados ao provedor dela).
  [/^POST$/, /^\/ordens-servico\/[^/]+\/(conversa-cliente|encerrar)$/],
  [/^GET$/, /^\/chat-clientes\/(conversas|conversas\/[^/]+\/mensagens|mensagens\/[^/]+\/anexo)$/],
  [/^POST$/, /^\/chat-clientes\/conversas\/[^/]+\/(mensagens|encerrar)$/],
];

export function atendentePode(metodo: string, url: string): boolean {
  const caminho = url.split("?")[0]!;
  return PERMITIDO_ATENDENTE.some(([m, c]) => m.test(metodo) && c.test(caminho));
}

/**
 * O que o VENDEDOR alcanca — so o pre-cadastro (que ja agenda a instalacao) e o
 * basico da sessao. Agenda, fila e OS ficam fechadas: ele agenda pela rota do
 * proprio pre-cadastro, nunca em OS de outro.
 */
const PERMITIDO_VENDEDOR: [RegExp, RegExp][] = [
  [/./, /^\/auth(\/|$)/],
  [/./, /^\/notificacoes(\/|$)/],
  // `eventos`: o SSE e por usuario (so o que e dele); sem ele a casca do app reconecta em loop.
  [/^GET$/, /^\/(hora|config|eventos)(\/|$)/],
  [/./, /^\/pre-cadastro(\/|$)/],
  // Chat interno da equipe (grupo e avisos ja exigem gestao na propria rota).
  [/./, /^\/chat(\/|$)/],
  // Chat com o cliente: as mesmas rotas da atendente — ler, responder e encerrar
  // as conversas DELE (o escopo fica no servico). Iniciar conversa com numero
  // avulso (template pago) fica fechado: ele abre pelo pre-cadastro do cliente.
  [/^GET$/, /^\/chat-clientes\/(conversas|conversas\/[^/]+\/mensagens|mensagens\/[^/]+\/anexo)$/],
  [/^POST$/, /^\/chat-clientes\/conversas\/[^/]+\/(mensagens|encerrar)$/],
];

export function vendedorPode(metodo: string, url: string): boolean {
  const caminho = url.split("?")[0]!;
  return PERMITIDO_VENDEDOR.some(([m, c]) => m.test(metodo) && c.test(caminho));
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

