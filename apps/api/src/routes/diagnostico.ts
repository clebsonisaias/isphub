import { Router } from "express";
import { OS_STATUS_ABERTOS, OsStatus, UserRole } from "@isphub/shared";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { prisma } from "../lib/prisma.js";
import { buildConnector } from "../services/erpConnectorService.js";

/**
 * "Abri uma OS no SGP e ela nao apareceu no ISPhub. Cade?"
 *
 * Essa pergunta ja custou duas investigacoes longas, e as duas vezes a resposta
 * estava espalhada por lugares diferentes: o espelho, a categoria do tipo (que
 * manda a OS pra /retiradas sem avisar ninguem), o recorte da fila, a posicao
 * na ordenacao — e, na ultima vez, uma reconciliacao que cancelou OS viva.
 *
 * Esta rota percorre o funil inteiro e responde de uma vez so. A ideia e que
 * ninguem mais precise ler log de producao pra saber onde uma OS foi parar.
 */
export const diagnosticoRouter = Router();

// So ADMIN: a resposta cruza dados de todos os provedores e expoe o nome do
// cliente. Nao e uma tela de operacao, e uma ferramenta de investigacao.
diagnosticoRouter.use(requireAuth, requireRole(UserRole.ADMIN));

diagnosticoRouter.get(
  "/os/:sgpOsId",
  asyncHandler(async (req, res) => {
    const { sgpOsId } = req.params;

    const os = await prisma.ordemServico.findFirst({
      where: { sgpOsId },
      include: {
        provedor: { select: { id: true, nome: true } },
        tipoOs: { include: { categoria: true } },
        tecnico: { select: { id: true, nome: true } },
        eventos: { orderBy: { criadoEm: "desc" }, take: 10 },
      },
    });

    if (!os) {
      res.json({
        sgpOsId,
        veredito: "Nao esta no espelho: o sync ainda nao trouxe esta OS.",
        noEspelho: false,
        proximoPasso:
          "Confira se o provedor tem erpConfig ativa e veja o log '[funil] ... SGP devolveu N | espelho tem M'.",
      });
      return;
    }

    const aberta = OS_STATUS_ABERTOS.includes(os.status as OsStatus);
    const categoria = os.tipoOs?.categoria ?? null;
    const equipeExterna = categoria?.equipeExterna ?? false;

    /*
     * A posicao na lista e o que faz a OS "sumir" sem ter sumido: a ordenacao
     * padrao e por urgencia, e OS sem SLA vai pro fim. Com 60+ abertas e 20 por
     * pagina, uma OS nova cai na pagina 4 e ninguem rola ate la.
     */
    const irmasNaMesmaTela = aberta
      ? await prisma.ordemServico.count({
          where: {
            provedorId: os.provedorId,
            status: { in: OS_STATUS_ABERTOS },
            ...(equipeExterna
              ? { tipoOs: { categoria: { equipeExterna: true } } }
              : {
                  OR: [
                    { tipoOsId: null },
                    { tipoOs: { categoriaId: null } },
                    { tipoOs: { categoria: { equipeExterna: false } } },
                  ],
                }),
          },
        })
      : 0;

    // O que o SGP diz sobre ela AGORA. Vai junto o FORMATO da resposta quando
    // nao der pra ler — e o dado que faltava pra saber por que a consulta
    // individual nunca era entendida.
    let noSgp: unknown = { tipo: "sem_integracao_ativa" };
    const config = await prisma.erpConfig.findFirst({
      where: { provedorId: os.provedorId, tipo: "SGP", ativo: true },
    });
    if (config) {
      try {
        noSgp = await buildConnector(config).obterStatusOs(sgpOsId);
      } catch (e) {
        noSgp = { tipo: "falhou", motivo: e instanceof Error ? e.message : String(e) };
      }
    }

    const canceladaPeloSync = os.eventos.some((ev) => ev.descricao.includes("Removida no SGP"));

    res.json({
      sgpOsId,
      noEspelho: true,
      veredito: montarVeredito({ aberta, equipeExterna, temCategoria: !!categoria, canceladaPeloSync }),
      onde: {
        tela: !aberta ? "aba Concluidas" : equipeExterna ? "/retiradas" : "Painel",
        // Sem categoria a OS aparece no Painel, mas so sob "Nao classificado" —
        // e essa linha da barra lateral so e renderizada se a contagem for > 0.
        aviso: !categoria ? "Tipo sem categoria: aparece so em 'Nao classificado'." : undefined,
        osAbertasNaMesmaTela: irmasNaMesmaTela,
        paginasDe20: Math.ceil(irmasNaMesmaTela / 20),
      },
      espelho: {
        id: os.id,
        status: os.status,
        provedor: os.provedor,
        chegouEm: os.criadoEm,
        sincronizadoEm: os.sincronizadoEm,
        dataAgendamento: os.dataAgendamento,
        tecnico: os.tecnico,
        ausenciasConsecutivas: os.ausenciasConsecutivas,
      },
      classificacao: {
        tipoOs: os.tipoOs ? { id: os.tipoOs.id, descricao: os.tipoOs.descricao, sgpCodigo: os.tipoOs.sgpCodigo } : null,
        categoria: categoria ? { id: categoria.id, nome: categoria.nome, equipeExterna } : null,
      },
      noSgp,
      eventos: os.eventos.map((ev) => ({ tipo: ev.tipo, descricao: ev.descricao, em: ev.criadoEm })),
    });
  }),
);

/** Uma frase que responde a pergunta que motivou a consulta. */
function montarVeredito(f: {
  aberta: boolean;
  equipeExterna: boolean;
  temCategoria: boolean;
  canceladaPeloSync: boolean;
}): string {
  if (f.canceladaPeloSync && !f.aberta) {
    return "Foi CANCELADA pela reconciliacao do sync ('Removida no SGP') — confira `noSgp` antes de concluir que sumiu de verdade.";
  }
  if (!f.aberta) return "Nao esta mais aberta: saiu do Painel e esta na aba Concluidas.";
  if (f.equipeExterna) return "Esta aberta, mas a categoria e de equipe externa: ela vive em /retiradas, nao no Painel.";
  if (!f.temCategoria) return "Esta aberta no Painel, porem sem categoria — visivel so sob 'Nao classificado'.";
  return "Esta aberta e no Painel. Se nao apareceu, veja `onde.paginasDe20`: a ordenacao por urgencia joga OS sem SLA pro fim.";
}
