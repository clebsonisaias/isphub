import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { hashPassword } from "../services/authService.js";

/**
 * CRUD de usuarios (admin/gestor/tecnico/provedor). Tecnico e um usuario com
 * role=tecnico, sem vinculo com provedor — ver services/escopoService.ts.
 */
export const usuariosRouter = Router();

usuariosRouter.use(requireAuth);

const SELECT_PUBLICO = {
  id: true,
  nome: true,
  email: true,
  role: true,
  provedorId: true,
  ativo: true,
  criadoEm: true,
} as const;

usuariosRouter.get(
  "/",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const roleFiltro = req.query.role;
    const where =
      typeof roleFiltro === "string" && (Object.values(UserRole) as string[]).includes(roleFiltro)
        ? { role: roleFiltro as UserRole }
        : {};
    const usuarios = await prisma.usuario.findMany({ where, select: SELECT_PUBLICO, orderBy: { nome: "asc" } });
    res.json(usuarios);
  }),
);

/** provedorId so faz sentido pra role=provedor; para os demais papeis fica sempre null. */
function normalizarProvedorId(role: UserRole, provedorId?: string | null): string | null {
  return role === UserRole.PROVEDOR ? (provedorId ?? null) : null;
}

function validarProvedorObrigatorio(role: UserRole, provedorId: string | null) {
  if (role === UserRole.PROVEDOR && !provedorId) {
    throw new HttpError(400, "provedorId e obrigatorio para o papel provedor");
  }
}

/** Quantos admins ativos existem, exceto o id informado (pra checar antes de remover o ultimo). */
async function contarOutrosAdminsAtivos(excluirId: string): Promise<number> {
  return prisma.usuario.count({ where: { role: UserRole.ADMIN, ativo: true, id: { not: excluirId } } });
}

const criarSchema = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
  senha: z.string().min(8, "A senha deve ter pelo menos 8 caracteres"),
  role: z.nativeEnum(UserRole),
  provedorId: z.string().uuid().nullable().optional(),
});

usuariosRouter.post(
  "/",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const data = criarSchema.parse(req.body);
    const provedorId = normalizarProvedorId(data.role, data.provedorId);
    validarProvedorObrigatorio(data.role, provedorId);

    const senhaHash = await hashPassword(data.senha);
    const usuario = await prisma.usuario
      .create({
        data: { nome: data.nome, email: data.email, role: data.role, provedorId, senhaHash },
        select: SELECT_PUBLICO,
      })
      .catch((err) => {
        if (err?.code === "P2002") throw new HttpError(409, "Ja existe um usuario com esse e-mail");
        throw err;
      });
    res.status(201).json(usuario);
  }),
);

const atualizarSchema = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
  provedorId: z.string().uuid().nullable().optional(),
  ativo: z.boolean(),
});

usuariosRouter.put(
  "/:id",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const data = atualizarSchema.parse(req.body);
    const alvo = await prisma.usuario.findUnique({ where: { id: req.params.id } });
    if (!alvo) throw new HttpError(404, "Usuario nao encontrado");

    const provedorId = normalizarProvedorId(data.role, data.provedorId);
    validarProvedorObrigatorio(data.role, provedorId);

    const deixaDeSerAdminAtivo =
      alvo.role === UserRole.ADMIN && alvo.ativo && (data.role !== UserRole.ADMIN || !data.ativo);
    if (deixaDeSerAdminAtivo) {
      if (alvo.id === req.user!.sub) {
        throw new HttpError(400, "Voce nao pode remover seu proprio acesso de administrador");
      }
      if ((await contarOutrosAdminsAtivos(alvo.id)) === 0) {
        throw new HttpError(409, "Nao e possivel remover o ultimo administrador ativo");
      }
    }

    const usuario = await prisma.usuario
      .update({
        where: { id: alvo.id },
        data: { nome: data.nome, email: data.email, role: data.role, provedorId, ativo: data.ativo },
        select: SELECT_PUBLICO,
      })
      .catch((err) => {
        if (err?.code === "P2002") throw new HttpError(409, "Ja existe um usuario com esse e-mail");
        throw err;
      });
    res.json(usuario);
  }),
);

const resetSenhaSchema = z.object({
  novaSenha: z.string().min(8, "A nova senha deve ter pelo menos 8 caracteres"),
});

usuariosRouter.post(
  "/:id/senha",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const { novaSenha } = resetSenhaSchema.parse(req.body);
    const senhaHash = await hashPassword(novaSenha);
    const usuario = await prisma.usuario
      .update({ where: { id: req.params.id }, data: { senhaHash }, select: SELECT_PUBLICO })
      .catch(() => {
        throw new HttpError(404, "Usuario nao encontrado");
      });
    res.json(usuario);
  }),
);

/** Soft-delete (ativo=false) — OS e atribuicoes referenciam o usuario, nao da pra apagar de verdade. */
usuariosRouter.delete(
  "/:id",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const alvo = await prisma.usuario.findUnique({ where: { id: req.params.id } });
    if (!alvo) throw new HttpError(404, "Usuario nao encontrado");
    if (alvo.id === req.user!.sub) throw new HttpError(400, "Voce nao pode desativar sua propria conta");
    if (alvo.role === UserRole.ADMIN && alvo.ativo && (await contarOutrosAdminsAtivos(alvo.id)) === 0) {
      throw new HttpError(409, "Nao e possivel desativar o ultimo administrador ativo");
    }

    const usuario = await prisma.usuario.update({
      where: { id: alvo.id },
      data: { ativo: false },
      select: SELECT_PUBLICO,
    });
    res.json(usuario);
  }),
);
