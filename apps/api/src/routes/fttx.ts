import { Router } from "express";
import { z } from "zod";
import type { Olt, OnuAutorizada, OnuNaoAutorizada } from "@isphub/shared";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { buildConnector } from "../services/erpConnectorService.js";
import { assertProvedorPermitido, osDoTecnicoWhere } from "../services/escopoService.js";
import { comConcorrenciaLimitada } from "../lib/limitador.js";

/**
 * Provisionamento FTTX por provedor (autorizar/desautorizar ONU numa OLT).
 * Mesmo desenho de conexao.ts: rota por-provedor, escopo do usuario PROVEDOR
 * restrito ao proprio provedor, conector construido a partir do ErpConfig SGP
 * ativo. Cada provedor tem o seu SGP, com as suas proprias OLTs — por isso o
 * fluxo comeca escolhendo o provedor (GET /provedores, ja liberado).
 *
 * Leituras (olts/onus/templates) e ESCRITAS de rede (autorizar/desautorizar)
 * passam pelo MESMO escopo de provedor (assertProvedor): admin/gestor livres,
 * provedor so no proprio, tecnico so onde tem OS atribuida. As escritas ainda
 * exigem ADMIN/GESTOR/TECNICO por papel.
 */
export const fttxRouter = Router({ mergeParams: true });

fttxRouter.use(requireAuth);

/** A lista de OLTs de um provedor quase nao muda — cache curto evita rajada ao SGP. */
const OLTS_CACHE_TTL_MS = 60_000;
const FTTX_MAX_CONCORRENTE_POR_PROVEDOR = 3;
const oltsCache = new Map<string, { valor: Olt[]; expiraEm: number }>();

/** Papeis que podem AUTORIZAR/DESAUTORIZAR (escrita de rede sensivel). */
const escritaRoles = [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO];

/**
 * Escopo de provedor. Ver escopoService.assertProvedorPermitido: admin/gestor
 * passam (desenho), provedor so no proprio, e o TECNICO so onde tem OS
 * atribuida — sem isso qualquer tecnico desautorizava ONU de qualquer ISP.
 */
async function assertProvedor(req: any, provedorId: string): Promise<void> {
  await assertProvedorPermitido(req.user!, provedorId, (tecnicoId, pid) =>
    prisma.ordemServico.count({ where: { provedorId: pid, ...osDoTecnicoWhere(tecnicoId) } }),
  );
}

async function connectorDoProvedor(provedorId: string) {
  const config = await prisma.erpConfig.findFirst({ where: { provedorId, tipo: "SGP", ativo: true } });
  if (!config) throw new HttpError(404, "Integracao SGP nao configurada/ativa para este provedor");
  return buildConnector(config);
}

/** OLTs cadastradas no SGP do provedor (cache curto). */
fttxRouter.get(
  "/olts",
  asyncHandler(async (req, res) => {
    const { provedorId } = req.params;
    await assertProvedor(req, provedorId);

    const emCache = oltsCache.get(provedorId);
    if (emCache && emCache.expiraEm > Date.now()) {
      res.json(emCache.valor);
      return;
    }

    const connector = await connectorDoProvedor(provedorId);
    const olts = await comConcorrenciaLimitada(provedorId, FTTX_MAX_CONCORRENTE_POR_PROVEDOR, () => connector.listarOlts());
    oltsCache.set(provedorId, { valor: olts, expiraEm: Date.now() + OLTS_CACHE_TTL_MS });
    res.json(olts);
  }),
);

const onusQuery = z.object({
  status: z.enum(["nao-autorizadas", "autorizadas"]).default("nao-autorizadas"),
  contrato: z.string().optional(),
  cpfcnpj: z.string().optional(),
});

/** ONUs da OLT — nao-autorizadas (default) ou autorizadas (busca por contrato/CPF). Sem cache: muda ao vivo. */
fttxRouter.get(
  "/olts/:oltId/onus",
  asyncHandler(async (req, res) => {
    const { provedorId, oltId } = req.params;
    await assertProvedor(req, provedorId);
    const { status, contrato, cpfcnpj } = onusQuery.parse(req.query);

    const connector = await connectorDoProvedor(provedorId);
    const onus = await comConcorrenciaLimitada<OnuNaoAutorizada[] | OnuAutorizada[]>(
      provedorId,
      FTTX_MAX_CONCORRENTE_POR_PROVEDOR,
      () =>
        status === "autorizadas"
          ? connector.listarOnusAutorizadas(oltId, { contrato, cpfcnpj })
          : connector.listarOnusNaoAutorizadas(oltId),
    );
    res.json(onus);
  }),
);

/** Templates/perfis de ONU da OLT (pra provisionar por perfil pronto). */
fttxRouter.get(
  "/olts/:oltId/templates",
  asyncHandler(async (req, res) => {
    const { provedorId, oltId } = req.params;
    await assertProvedor(req, provedorId);
    const connector = await connectorDoProvedor(provedorId);
    res.json(await connector.listarTemplatesOnu(oltId));
  }),
);

const autorizarSchema = z.object({
  slot: z.union([z.string(), z.number()]).transform(String),
  pon: z.union([z.string(), z.number()]).transform(String),
  serial: z.string().min(1),
  // onutype opcional: o SGP detecta o modelo pelo SN (autofind) quando ausente.
  onutype: z.string().optional(),
  mode: z.union([z.literal(1), z.literal(2)]),
  vlan: z.number().int().optional(),
  contrato: z.string().optional(),
  service: z.string().optional(),
  pppoeLogin: z.string().optional(),
  pppoeSenha: z.string().optional(),
  onutemplate: z.string().optional(),
  descricao: z.string().max(500).optional(),
  ident: z.string().max(120).optional(),
});

/** Autoriza (provisiona) uma ONU na OLT — ESCRITA de rede. */
fttxRouter.post(
  "/olts/:oltId/onus/autorizar",
  requireRole(...escritaRoles),
  asyncHandler(async (req, res) => {
    const { provedorId, oltId } = req.params;
    await assertProvedor(req, provedorId);
    const dados = autorizarSchema.parse(req.body);
    const connector = await connectorDoProvedor(provedorId);
    const resultado = await connector.provisionarOnu(oltId, dados);
    res.status(201).json(resultado);
  }),
);

/** Desautoriza (remove) uma ONU autorizada — ESCRITA de rede. */
fttxRouter.post(
  "/onus/:onuId/desautorizar",
  requireRole(...escritaRoles),
  asyncHandler(async (req, res) => {
    const { provedorId, onuId } = req.params;
    await assertProvedor(req, provedorId);
    const connector = await connectorDoProvedor(provedorId);
    res.json(await connector.desautorizarOnu(onuId));
  }),
);
