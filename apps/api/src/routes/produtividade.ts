import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { escopoOsWhere } from "../services/escopoService.js";
import { MAXIMO_DIAS, produtividade } from "../services/biProdutividadeService.js";
import { calcularMeuDesempenho } from "../services/meuDesempenhoService.js";

/**
 * Produtividade da equipe — ADMIN e GESTOR.
 *
 * TECNICO fica de fora, e a razao nao e tecnica: um ranking em que cada um ve a
 * propria posicao contra a dos colegas muda o que as pessoas fazem, e essa e
 * uma decisao de gestao, nao de codigo. Enquanto ninguem pedir, quem le e quem
 * ja responde pela equipe. (PROVEDOR tambem nao: a equipe e da HubISP.)
 *
 * Rota fina — toda a regra esta em `biProdutividadeService` e nas funcoes puras
 * de `packages/shared/src/produtividade.ts`, que tem teste.
 */
export const produtividadeRouter = Router();

produtividadeRouter.use(requireAuth);

const periodoSchema = z
  .object({
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    provedorId: z.string().uuid().optional(),
  })
  .transform((v) => {
    /*
     * `-03:00` e nao `Z`: quem digita "12/05" quer o dia dele. Com sufixo `Z` a
     * janela abriria as 21h do dia anterior em Natal, e a serie — agrupada pelo
     * dia brasileiro — comecaria num dia que o filtro nao mostra. Mesmo defeito
     * ja corrigido no BI da frota.
     */
    const ate = v.ate ? new Date(`${v.ate}T23:59:59.999-03:00`) : new Date();
    const de = v.de
      ? new Date(`${v.de}T00:00:00.000-03:00`)
      : new Date(ate.getTime() - 29 * 24 * 60 * 60_000);
    return { de, ate, provedorId: v.provedorId };
  })
  .refine((v) => v.de <= v.ate, { message: "O início do período não pode ser depois do fim." })
  .refine((v) => (v.ate.getTime() - v.de.getTime()) / 86_400_000 <= MAXIMO_DIAS, {
    // Recusa explicita em vez de recorte silencioso: um periodo cortado sem
    // aviso devolveria menos OS do que existem, e o gestor leria isso como
    // queda de produtividade.
    message: `O período não pode passar de ${MAXIMO_DIAS} dias.`,
  });

produtividadeRouter.get(
  "/bi",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { de, ate, provedorId } = periodoSchema.parse(req.query);
    res.json(await produtividade(escopoOsWhere(req.user!, provedorId), de, ate));
  }),
);

/**
 * Painel de metas e ranking privado do técnico (Gamificação).
 * Retorna as métricas e posição individual do técnico sem expor nomes de terceiros.
 */
produtividadeRouter.get(
  "/meu-desempenho",
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo === "mes" ? "mes" : "semana";
    const provedorId = req.user!.provedorId;
    const resultado = await calcularMeuDesempenho(req.user!.id, provedorId, periodo);
    res.json(resultado);
  }),
);
