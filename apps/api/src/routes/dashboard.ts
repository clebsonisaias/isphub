import { Router } from "express";
import { OsStatus, OS_STATUS_ABERTOS, UserRole, type DashboardMetrics } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { calcularSla } from "../services/slaService.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

/**
 * Metricas agregadas para o dashboard do Gestor. role=provedor so ve os
 * proprios numeros. SLA estourado e computado em memoria (depende do
 * slaHoras do tipo de OS, que nao da para agregar direto em SQL de forma
 * simples) — aceitavel para o volume esperado no MVP.
 */
dashboardRouter.get(
  "/metrics",
  asyncHandler(async (req, res) => {
    const provedorId = req.user!.role === UserRole.PROVEDOR ? req.user!.provedorId ?? "__nenhum__" : undefined;
    const where = provedorId ? { provedorId } : {};

    const [totalAbertas, totalConcluidas, ordensAbertasComSla, provedores, statusGroups, tecnicoGroups] =
      await Promise.all([
        prisma.ordemServico.count({ where: { ...where, status: { in: OS_STATUS_ABERTOS } } }),
        prisma.ordemServico.count({ where: { ...where, status: OsStatus.CONCLUIDA } }),
        prisma.ordemServico.findMany({
          where: { ...where, status: { in: OS_STATUS_ABERTOS } },
          select: { dataAgendamento: true, criadoEm: true, tipoOs: { select: { slaHoras: true } } },
        }),
        prisma.provedor.findMany({ where: provedorId ? { id: provedorId } : {} }),
        prisma.ordemServico.groupBy({ by: ["status"], where, _count: { _all: true } }),
        prisma.ordemServico.groupBy({
          by: ["tecnicoId"],
          where: { ...where, tecnicoId: { not: null } },
          _count: { _all: true },
        }),
      ]);

    const slaEstourado = ordensAbertasComSla.filter(
      (os) =>
        calcularSla({ slaHoras: os.tipoOs?.slaHoras, dataBase: os.dataAgendamento ?? os.criadoEm }).semaforo ===
        "vermelho",
    ).length;

    const porProvedor = await Promise.all(
      provedores.map(async (p) => {
        const [abertas, concluidas] = await Promise.all([
          prisma.ordemServico.count({ where: { provedorId: p.id, status: { in: OS_STATUS_ABERTOS } } }),
          prisma.ordemServico.count({ where: { provedorId: p.id, status: OsStatus.CONCLUIDA } }),
        ]);
        return { provedorId: p.id, provedorNome: p.nome, cor: p.cor, abertas, concluidas };
      }),
    );

    const porStatus = statusGroups.map((g) => ({ status: g.status as OsStatus, total: g._count._all }));

    const tecnicoIds = tecnicoGroups.map((g) => g.tecnicoId).filter((id): id is string => !!id);
    const tecnicos = tecnicoIds.length
      ? await prisma.tecnico.findMany({ where: { id: { in: tecnicoIds } } })
      : [];
    const nomeTecnico = new Map(tecnicos.map((t) => [t.id, t.nome]));

    const porTecnico = await Promise.all(
      tecnicoGroups.map(async (g) => {
        const tecnicoId = g.tecnicoId as string;
        const [abertas, concluidas] = await Promise.all([
          prisma.ordemServico.count({ where: { tecnicoId, status: { in: OS_STATUS_ABERTOS } } }),
          prisma.ordemServico.count({ where: { tecnicoId, status: OsStatus.CONCLUIDA } }),
        ]);
        return { tecnicoId, tecnicoNome: nomeTecnico.get(tecnicoId) ?? "?", abertas, concluidas };
      }),
    );

    const metrics: DashboardMetrics = {
      totalAbertas,
      totalConcluidas,
      porProvedor,
      porStatus,
      porTecnico,
      slaEstourado,
    };

    res.json(metrics);
  }),
);
