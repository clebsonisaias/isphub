import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  FUNCOES_CAMPO,
  PAPEIS_SGP,
  decidirTecnicoSgp,
  espelharDespachoSgp,
  listarTecnicosSgp,
  sincronizarAtendentesSgp,
  sincronizarTecnicosSgp,
} from "../services/tecnicosSgpService.js";

/**
 * Abas "Tecnicos do SGP" e "Atendentes do SGP" (`?papel=atendente`) do
 * provedor: a lista que o SGP conhece e, pra cada um, a decisao do admin/
 * supervisor — vincular, criar (sem login) ou ignorar — e a funcao do tecnico.
 */
export const tecnicosSgpRouter = Router({ mergeParams: true });

tecnicosSgpRouter.use(requireAuth, requireRole(UserRole.ADMIN));

const papelDe = (q: unknown) => z.object({ papel: z.enum(PAPEIS_SGP).default("tecnico") }).parse(q).papel;

/** Vinculo novo de tecnico ja reflete nas OS abertas, sem esperar o proximo sync. */
function espelharEmSegundoPlano(provedorId: string) {
  void espelharDespachoSgp(provedorId).catch((e) => console.warn("[tecnicos-sgp] espelho do despacho falhou:", e));
}

tecnicosSgpRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listarTecnicosSgp(req.params.provedorId!, papelDe(req.query)));
  }),
);

/** `POST /sincronizar` — busca agora no SGP (o job tambem faz todo dia as 06:10). */
tecnicosSgpRouter.post(
  "/sincronizar",
  asyncHandler(async (req, res) => {
    const provedorId = req.params.provedorId!;
    if (papelDe(req.query) === "atendente") return void res.json(await sincronizarAtendentesSgp(provedorId));
    res.json(await sincronizarTecnicosSgp(provedorId));
    espelharEmSegundoPlano(provedorId);
  }),
);

tecnicosSgpRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const d = z
      .object({
        usuarioId: z.string().uuid().nullable().optional(),
        criar: z.boolean().optional(),
        ignorado: z.boolean().optional(),
        funcao: z.enum(FUNCOES_CAMPO).nullable().optional(),
      })
      .parse(req.body);
    const item = await decidirTecnicoSgp(req.params.provedorId!, req.params.id!, d);
    res.json(item);
    if (item?.papel === "tecnico") espelharEmSegundoPlano(req.params.provedorId!);
  }),
);
