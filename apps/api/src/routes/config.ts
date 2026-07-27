import { Router } from "express";
import { z } from "zod";
import { MODULO_CATALOGO, MODULO_IDS, isModuloId, UserRole, type ModuloId } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { montarModulosHabilitados, togglePatchInvalido, type ModuloConfigRow } from "../services/moduloService.js";

/**
 * `GET /config` — config efetiva do app do tecnico pro usuario logado. Cruza o
 * catalogo (codigo) com os registros do admin (banco) e o papel. O app monta a
 * navegacao a partir daqui.
 */
export const configRouter = Router();

configRouter.use(requireAuth);

configRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const registros = (await prisma.moduloConfig.findMany()) as ModuloConfigRow[];
    const modulos = montarModulosHabilitados(registros, req.user!.role);
    res.json({ modulos, geradoEm: new Date().toISOString() });
  }),
);

/**
 * `/admin/modulos` — CRUD/toggle dos modulos (so ADMIN). Fonte da verdade do
 * estado editavel; o app reflete via `/config`.
 */
export const adminModulosRouter = Router();

adminModulosRouter.use(requireAuth, requireRole(UserRole.ADMIN));

/** Catalogo completo (inclui desligados e core) com o estado atual, pra tela de admin. */
adminModulosRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const registros = await prisma.moduloConfig.findMany();
    const porId = new Map(registros.map((r) => [r.moduloId, r]));
    const modulos = MODULO_IDS.map((id) => {
      const meta = MODULO_CATALOGO[id];
      const reg = porId.get(id);
      return {
        id,
        nome: meta.nome,
        icone: meta.icone,
        core: meta.core,
        ativo: meta.core ? true : (reg?.ativo ?? meta.ativoPadrao),
        ordem: reg?.ordem ?? meta.ordemPadrao,
        rolesPermitidos: reg?.rolesPermitidos ?? meta.rolesPadrao,
      };
    }).sort((a, b) => a.ordem - b.ordem);
    res.json(modulos);
  }),
);

const patchSchema = z.object({
  ativo: z.boolean().optional(),
  ordem: z.number().int().optional(),
  rolesPermitidos: z.array(z.nativeEnum(UserRole)).optional(),
});

adminModulosRouter.patch(
  "/:moduloId",
  asyncHandler(async (req, res) => {
    const moduloId = req.params.moduloId;
    if (!isModuloId(moduloId)) throw new HttpError(404, "Modulo desconhecido");
    const patch = patchSchema.parse(req.body);

    // Guarda de core (servidor): core nao desliga, mesmo que a UI mande.
    if (togglePatchInvalido(moduloId as ModuloId, patch)) {
      throw new HttpError(422, "Este modulo e essencial e nao pode ser desativado");
    }

    const meta = MODULO_CATALOGO[moduloId as ModuloId];
    const atualizado = await prisma.moduloConfig.upsert({
      where: { moduloId },
      create: {
        moduloId,
        ativo: patch.ativo ?? meta.ativoPadrao,
        ordem: patch.ordem ?? meta.ordemPadrao,
        rolesPermitidos: patch.rolesPermitidos ?? meta.rolesPadrao,
      },
      update: {
        ...(patch.ativo !== undefined ? { ativo: patch.ativo } : {}),
        ...(patch.ordem !== undefined ? { ordem: patch.ordem } : {}),
        ...(patch.rolesPermitidos !== undefined ? { rolesPermitidos: patch.rolesPermitidos } : {}),
      },
    });
    res.json(atualizado);
  }),
);
