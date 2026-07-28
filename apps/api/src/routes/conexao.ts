import { Router } from "express";
import type { DetalhesTecnicos } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { buildConnector } from "../services/erpConnectorService.js";
import { assertProvedorPermitido } from "../services/escopoService.js";
import { comConcorrenciaLimitada } from "../lib/limitador.js";

export const conexaoRouter = Router({ mergeParams: true });

conexaoRouter.use(requireAuth);

/**
 * O Painel passou a mostrar online/offline + endereco direto em cada card da
 * fila (antes so existia sob demanda no dialog de detalhe) — uma pagina com
 * ate 50 OS pode disparar ate 50 consultas ao vivo ao mesmo SGP de provedor.
 * Cache curto (a conexao/endereco de um contrato nao muda a cada segundo) +
 * limite de concorrencia por provedor evitam que isso vire uma rajada capaz
 * de derrubar/travar o SGP do provedor.
 */
const DETALHES_CACHE_TTL_MS = 90_000;
const DETALHES_MAX_CONCORRENTE_POR_PROVEDOR = 4;
const detalhesCache = new Map<string, { valor: DetalhesTecnicos; expiraEm: number }>();

/**
 * Escopo de provedor. Ver escopoService.assertProvedorPermitido.
 *
 * Antes so barrava `role=provedor`, entao qualquer autenticado consultava
 * qualquer provedor — e `contratoId` e um numero sequencial do SGP, entao dava
 * pra iterar 1..N e colher endereco e lat/lng de assinante por assinante de um
 * ISP com o qual o usuario nao tem nenhuma relacao. Nao ha rate limit aqui: o
 * `comConcorrenciaLimitada` e uma FILA de concorrencia (limita quantas ao mesmo
 * tempo), nunca recusa — nao segura enumeracao sequencial.
 */
async function assertProvedor(req: any, provedorId: string): Promise<void> {
  await assertProvedorPermitido(req.user!, provedorId, (tecnicoId, pid) =>
    prisma.ordemServico.count({ where: { tecnicoId, provedorId: pid } }),
  );
}

/**
 * Consulta ao vivo (nao faz parte do sync em massa — chamada sob demanda ao
 * abrir o detalhe de uma OS/ocorrencia) se o servico do contrato esta
 * online ou offline agora no SGP.
 */
conexaoRouter.get(
  "/:contratoId",
  asyncHandler(async (req, res) => {
    const { provedorId, contratoId } = req.params;

    await assertProvedor(req, provedorId);

    const config = await prisma.erpConfig.findFirst({ where: { provedorId, tipo: "SGP", ativo: true } });
    if (!config) throw new HttpError(404, "Integracao SGP nao configurada/ativa para este provedor");

    const connector = buildConnector(config);
    const resultado = await connector.checkConnectionStatus(contratoId);
    res.json(resultado);
  }),
);

/**
 * Detalhes tecnicos completos do contrato (endereco de rua, sinal da ONU em
 * dBm, status de conexao) — consulta ao vivo, sob demanda, ao abrir o
 * detalhe de uma OS/ocorrencia. Complementa /:contratoId (que so traz
 * online/offline) com dados que o SGP so expoe no cadastro do cliente.
 */
conexaoRouter.get(
  "/:contratoId/detalhes",
  asyncHandler(async (req, res) => {
    const { provedorId, contratoId } = req.params;

    await assertProvedor(req, provedorId);

    const chaveCache = `${provedorId}:${contratoId}`;
    const emCache = detalhesCache.get(chaveCache);
    if (emCache && emCache.expiraEm > Date.now()) {
      res.json(emCache.valor);
      return;
    }

    const config = await prisma.erpConfig.findFirst({ where: { provedorId, tipo: "SGP", ativo: true } });
    if (!config) throw new HttpError(404, "Integracao SGP nao configurada/ativa para este provedor");

    const connector = buildConnector(config);
    const resultado = await comConcorrenciaLimitada(provedorId, DETALHES_MAX_CONCORRENTE_POR_PROVEDOR, () =>
      connector.getDetalhesTecnicos(contratoId),
    );
    detalhesCache.set(chaveCache, { valor: resultado, expiraEm: Date.now() + DETALHES_CACHE_TTL_MS });
    res.json(resultado);
  }),
);
