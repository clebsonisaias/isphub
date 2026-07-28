import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import type { UsuarioPublic } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { hashPassword, signToken, verifyPassword } from "../services/authService.js";
import { invalidarCacheSessao } from "../services/sessaoService.js";

export const authRouter = Router();

/**
 * Limita tentativas de login para dificultar credential stuffing/brute force.
 *
 * A chave e `ip + email`, NAO so o IP: com a API atras do proxy do Coolify,
 * a chave por IP colocava a operacao inteira num balde unico — 10 tentativas
 * erradas de um desconhecido travavam o login de todos os tecnicos por 15 min,
 * e o atacante real dividia o mesmo balde com as vitimas (nenhuma protecao de
 * verdade). Combinar com `app.set("trust proxy", 1)` em app.ts.
 *
 * `skipSuccessfulRequests`: quem acerta a senha nao consome o balde — assim
 * um tecnico que erra uma vez e acerta na segunda nunca fica preso.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip ?? "");
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    return `${ip}:${email}`;
  },
  message: { error: "Muitas tentativas de login. Tente novamente em alguns minutos." },
});

const loginSchema = z.object({
  email: z.string().email(),
  // Teto de tamanho: sem ele, um corpo enorme atravessa ate o bcrypt a cada
  // tentativa. bcrypt trunca em 72 bytes, entao nada acima disso e util.
  senha: z.string().min(1).max(200),
});

function toPublic(u: {
  id: string;
  nome: string;
  email: string;
  role: string;
  provedorId: string | null;
  ativo: boolean;
}): UsuarioPublic {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    role: u.role as UsuarioPublic["role"],
    provedorId: u.provedorId,
    ativo: u.ativo,
  };
}

authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, senha } = loginSchema.parse(req.body);

    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario || !usuario.ativo) {
      throw new HttpError(401, "Credenciais invalidas");
    }

    const senhaOk = await verifyPassword(senha, usuario.senhaHash);
    if (!senhaOk) {
      throw new HttpError(401, "Credenciais invalidas");
    }

    const token = signToken({
      sub: usuario.id,
      email: usuario.email,
      role: usuario.role as UsuarioPublic["role"],
      provedorId: usuario.provedorId,
      tv: usuario.tokenVersion,
    });

    res.json({ token, usuario: toPublic(usuario) });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.sub } });
    // Revalida ativo a cada chamada — sem isso, desativar um usuario nao
    // derruba a sessao dele ate o token expirar (ate 8h por padrao).
    if (!usuario || !usuario.ativo) throw new HttpError(401, "Usuario nao encontrado ou inativo");
    res.json(toPublic(usuario));
  }),
);

const senhaSchema = z.object({
  senhaAtual: z.string().min(1),
  novaSenha: z.string().min(8, "A nova senha deve ter pelo menos 8 caracteres"),
});

authRouter.post(
  "/senha",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { senhaAtual, novaSenha } = senhaSchema.parse(req.body);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.sub } });
    if (!usuario || !usuario.ativo) throw new HttpError(401, "Usuario nao encontrado ou inativo");

    const ok = await verifyPassword(senhaAtual, usuario.senhaHash);
    if (!ok) throw new HttpError(401, "Senha atual incorreta");

    const senhaHash = await hashPassword(novaSenha);
    // Trocar a senha DERRUBA as outras sessoes (tokenVersion++). Se a troca foi
    // por suspeita de vazamento, deixar o token antigo valendo mais 8h anularia
    // o proposito. O proprio usuario recebe um token novo abaixo, entao ele nao
    // e deslogado do aparelho onde acabou de trocar.
    const atualizado = await prisma.usuario.update({
      where: { id: usuario.id },
      data: { senhaHash, tokenVersion: { increment: 1 } },
    });
    invalidarCacheSessao(usuario.id);

    const token = signToken({
      sub: atualizado.id,
      email: atualizado.email,
      role: atualizado.role as UsuarioPublic["role"],
      provedorId: atualizado.provedorId,
      tv: atualizado.tokenVersion,
    });
    res.json({ token });
  }),
);
