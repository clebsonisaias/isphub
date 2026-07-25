import { Router } from "express";
import { z } from "zod";
import type { UsuarioPublic } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { signToken, verifyPassword } from "../services/authService.js";

export const authRouter = Router();

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
}): UsuarioPublic {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    role: u.role as UsuarioPublic["role"],
    provedorId: u.provedorId,
  };
}

authRouter.post(
  "/login",
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
    if (!usuario) throw new HttpError(404, "Usuario nao encontrado");
    res.json(toPublic(usuario));
  }),
);
