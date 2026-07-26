import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { UsuarioPublic } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { hashPassword, signToken, verifyPassword } from "../services/authService.js";

export const authRouter = Router();

/** Limita tentativas de login por IP para dificultar credential stuffing/brute force. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Tente novamente em alguns minutos." },
});

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
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
    await prisma.usuario.update({ where: { id: usuario.id }, data: { senhaHash } });
    res.status(204).send();
  }),
);
