import { Router } from "express";
import { z } from "zod";
import { UserRole, type JornadaResposta, type TecnicoEmJornada } from "@isphub/shared";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { encerrarJornada, iniciarJornada, jornadaAtual, jornadasAtivas } from "../services/jornadaService.js";

/**
 * Jornada do tecnico — marcador operacional de turno.
 *
 * Rota fina: toda a regra (idempotencia, acoplamento com o status do perfil,
 * corrida no INSERT) mora em `jornadaService`, que tem teste. Aqui so entra
 * validacao de entrada e o escopo por papel.
 */
export const jornadaRouter = Router();

jornadaRouter.use(requireAuth);

/**
 * Coordenada do momento. **Opcional de proposito**: permissao de localizacao
 * negada nao pode impedir alguem de bater o inicio do turno — a jornada e o
 * dado principal, a posicao e um complemento.
 */
const geoSchema = z.object({
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

/**
 * `agoraServidor` acompanha TODA resposta.
 *
 * O cronometro do app e `agora - inicioEm`, e `inicioEm` foi carimbado por este
 * relogio. Se o app medisse com o relogio do aparelho, um celular desacertado
 * mostraria um "tempo trabalhado" errado — justamente o numero que o tecnico
 * confere. Mandando junto, os dois carimbos saem da mesma fonte e na mesma
 * resposta, sem requisicao extra.
 */
function resposta(jornada: JornadaResposta["jornada"]): JornadaResposta {
  return { jornada, agoraServidor: new Date().toISOString() };
}

jornadaRouter.get(
  "/atual",
  asyncHandler(async (req, res) => {
    res.json(resposta(await jornadaAtual(req.user!.sub)));
  }),
);

jornadaRouter.post(
  "/iniciar",
  asyncHandler(async (req, res) => {
    const geo = geoSchema.parse(req.body ?? {});
    res.json(resposta(await iniciarJornada(req.user!.sub, geo)));
  }),
);

jornadaRouter.post(
  "/encerrar",
  asyncHandler(async (req, res) => {
    const geo = geoSchema.parse(req.body ?? {});
    res.json(resposta(await encerrarJornada(req.user!.sub, geo)));
  }),
);

/**
 * Quem esta em servico agora — tela do gestor.
 *
 * Restrita a ADMIN/GESTOR: e informacao sobre a jornada de OUTRAS pessoas.
 * Um tecnico ve a propria por `/atual`, e nao tem porque enxergar a dos colegas.
 */
jornadaRouter.get(
  "/ativas",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (_req, res) => {
    const ativas: TecnicoEmJornada[] = await jornadasAtivas();
    res.json(ativas);
  }),
);
