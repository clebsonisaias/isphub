import { Router } from "express";
import { OsStatus, OS_STATUS_ABERTOS, UserRole, type DashboardMetrics } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { calcularSla } from "../services/slaService.js";
import { escopoOsWhere } from "../services/escopoService.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

/**
 * Metricas agregadas para o dashboard do Gestor. role=provedor so ve os
 * proprios numeros; role=tecnico so os proprios (o front nem mostra esta
 * tela pra tecnico, mas o escopo vale tambem contra acesso direto pela API).
 * SLA estourado e computado em memoria (depende do slaHoras do tipo de OS,
 * que nao da para agregar direto em SQL de forma simples) — aceitavel para
 * o volume esperado no MVP.
 */
dashboardRouter.get(
  "/metrics",
  asyncHandler(async (req, res) => {
    const where = escopoOsWhere(req.user!);
    const provedorIdRestrito = req.user!.role === UserRole.PROVEDOR ? (req.user!.provedorId ?? "__nenhum__") : undefined;

    const [totalAbertas, totalConcluidas, ordensAbertasComSla, provedores, statusGroups, tecnicoGroups, ordensCategoria] =
      await Promise.all([
        prisma.ordemServico.count({ where: { ...where, status: { in: OS_STATUS_ABERTOS } } }),
        prisma.ordemServico.count({ where: { ...where, status: OsStatus.CONCLUIDA } }),
        prisma.ordemServico.findMany({
          where: { ...where, status: { in: OS_STATUS_ABERTOS } },
          select: {
            dataAgendamento: true,
            dataCadastro: true,
            criadoEm: true,
            tipoOs: { select: { slaHoras: true, categoria: { select: { slaHorasPadrao: true } } } },
          },
        }),
        prisma.provedor.findMany({ where: provedorIdRestrito ? { id: provedorIdRestrito } : {} }),
        prisma.ordemServico.groupBy({ by: ["status"], where, _count: { _all: true } }),
        prisma.ordemServico.groupBy({
          by: ["tecnicoId"],
          where: { ...where, tecnicoId: { not: null } },
          _count: { _all: true },
        }),
        // Categoria vem da relacao tipoOs, que o groupBy do Prisma nao agrega
        // direto — buscamos status+categoria e somamos em memoria (volume MVP).
        prisma.ordemServico.findMany({
          where,
          select: {
            status: true,
            tipoOs: { select: { categoria: { select: { id: true, nome: true, cor: true, icone: true } } } },
          },
        }),
      ]);

    const slaEstourado = ordensAbertasComSla.filter(
      (os) =>
        calcularSla({
          slaHoras: os.tipoOs?.slaHoras ?? os.tipoOs?.categoria?.slaHorasPadrao,
          dataBase: os.dataAgendamento ?? os.dataCadastro ?? os.criadoEm,
        }).semaforo === "vermelho",
    ).length;

    const porProvedor = await Promise.all(
      provedores.map(async (p) => {
        const [abertas, concluidas] = await Promise.all([
          prisma.ordemServico.count({ where: { ...where, provedorId: p.id, status: { in: OS_STATUS_ABERTOS } } }),
          prisma.ordemServico.count({ where: { ...where, provedorId: p.id, status: OsStatus.CONCLUIDA } }),
        ]);
        return { provedorId: p.id, provedorNome: p.nome, cor: p.cor, abertas, concluidas };
      }),
    );

    const porStatus = statusGroups.map((g) => ({ status: g.status as OsStatus, total: g._count._all }));

    // Agrega abertas/concluidas por categoria canonica do tipo de OS. Chave
    // null = "Nao classificado" (tipo sem categoria mapeada ainda).
    const abertosSet = new Set<string>(OS_STATUS_ABERTOS);
    const catAcc = new Map<
      string | null,
      { categoriaId: string | null; nome: string; cor: string; icone: string | null; abertas: number; concluidas: number }
    >();
    for (const os of ordensCategoria) {
      const categoria = os.tipoOs?.categoria ?? null;
      const chave = categoria?.id ?? null;
      const atual = catAcc.get(chave) ?? {
        categoriaId: chave,
        nome: categoria?.nome ?? "Não classificado",
        cor: categoria?.cor ?? "#94a3b8",
        icone: categoria?.icone ?? null,
        abertas: 0,
        concluidas: 0,
      };
      if (abertosSet.has(os.status)) atual.abertas += 1;
      else if (os.status === OsStatus.CONCLUIDA) atual.concluidas += 1;
      catAcc.set(chave, atual);
    }
    // "Nao classificado" sempre por ultimo; as demais na ordem que apareceram.
    const porCategoria = [...catAcc.values()].sort((a, b) => {
      if (a.categoriaId === null) return 1;
      if (b.categoriaId === null) return -1;
      return 0;
    });

    const tecnicoIds = tecnicoGroups.map((g) => g.tecnicoId).filter((id): id is string => !!id);
    const tecnicos = tecnicoIds.length
      ? await prisma.usuario.findMany({ where: { id: { in: tecnicoIds } } })
      : [];
    const nomeTecnico = new Map(tecnicos.map((t) => [t.id, t.nome]));

    const porTecnico = await Promise.all(
      tecnicoGroups.map(async (g) => {
        const tecnicoId = g.tecnicoId as string;
        const [abertas, concluidas] = await Promise.all([
          prisma.ordemServico.count({ where: { ...where, tecnicoId, status: { in: OS_STATUS_ABERTOS } } }),
          prisma.ordemServico.count({ where: { ...where, tecnicoId, status: OsStatus.CONCLUIDA } }),
        ]);
        return { tecnicoId, tecnicoNome: nomeTecnico.get(tecnicoId) ?? "?", abertas, concluidas };
      }),
    );

    const metrics: DashboardMetrics = {
      totalAbertas,
      totalConcluidas,
      porProvedor,
      porStatus,
      porCategoria,
      porTecnico,
      slaEstourado,
    };

    res.json(metrics);
  }),
);
