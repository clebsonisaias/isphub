import { Router } from "express";
import {
  OsStatus,
  OS_STATUS_ABERTOS,
  UserRole,
  type DashboardAgenda,
  type DashboardMetrics,
  type DashboardRetiradas,
  diaBrHoje,
  somarDias,
  type MeuDiaResumo,
  diaBrasileiro,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { z } from "zod";
import * as agenda from "../services/agendaService.js";
import { semPresencaDesde } from "../services/auditoriaVisitaService.js";
import { calcularSla } from "../services/slaService.js";
import { escopoOsWhere } from "../services/escopoService.js";
import { produtividade } from "../services/meuDiaService.js";
import { OS_EXTERNA_WHERE, OS_INTERNA_WHERE } from "../services/equipeService.js";

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
    const escopo = escopoOsWhere(req.user!);
    // A equipe da ISPhub nao executa retirada/cancelamento: as metricas da
    // operacao (abaixo) contam so as OS internas. As retiradas nao somem —
    // viram um bloco proprio (`retiradas`), pra continuarem visiveis sem
    // inflar o numero de trabalho que e da equipe.
    const where = { ...escopo, AND: [OS_INTERNA_WHERE] };
    const whereRetiradas = { ...escopo, AND: [OS_EXTERNA_WHERE] };
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

    // Bloco separado das retiradas/cancelamentos (equipe de fora) — mesmo
    // formato do `porProvedor` principal, so que escopado a `whereRetiradas`.
    // Reusa `provedores` (ja carregado com o escopo/restricao de provedor) em
    // vez de outra query.
    const [retiradasAbertas, retiradasConcluidas, retiradasAbertasComSla] = await Promise.all([
      prisma.ordemServico.count({ where: { ...whereRetiradas, status: { in: OS_STATUS_ABERTOS } } }),
      prisma.ordemServico.count({ where: { ...whereRetiradas, status: OsStatus.CONCLUIDA } }),
      prisma.ordemServico.findMany({
        where: { ...whereRetiradas, status: { in: OS_STATUS_ABERTOS } },
        select: {
          dataAgendamento: true,
          dataCadastro: true,
          criadoEm: true,
          tipoOs: { select: { slaHoras: true, categoria: { select: { slaHorasPadrao: true } } } },
        },
      }),
    ]);
    const retiradasSlaEstourado = retiradasAbertasComSla.filter(
      (os) =>
        calcularSla({
          slaHoras: os.tipoOs?.slaHoras ?? os.tipoOs?.categoria?.slaHorasPadrao,
          dataBase: os.dataAgendamento ?? os.dataCadastro ?? os.criadoEm,
        }).semaforo === "vermelho",
    ).length;
    const retiradasPorProvedorBruto = await Promise.all(
      provedores.map(async (p) => {
        const [abertas, concluidas] = await Promise.all([
          prisma.ordemServico.count({ where: { ...whereRetiradas, provedorId: p.id, status: { in: OS_STATUS_ABERTOS } } }),
          prisma.ordemServico.count({ where: { ...whereRetiradas, provedorId: p.id, status: OsStatus.CONCLUIDA } }),
        ]);
        return { provedorId: p.id, provedorNome: p.nome, cor: p.cor, abertas, concluidas };
      }),
    );
    // So lista provedor que de fato tem retirada — nao vale poluir o card com
    // zeros de provedores que nunca tiveram uma.
    const retiradas: DashboardRetiradas = {
      abertas: retiradasAbertas,
      concluidas: retiradasConcluidas,
      slaEstourado: retiradasSlaEstourado,
      porProvedor: retiradasPorProvedorBruto.filter((p) => p.abertas > 0 || p.concluidas > 0),
    };

    const metrics: DashboardMetrics = {
      totalAbertas,
      totalConcluidas,
      porProvedor,
      porStatus,
      porCategoria,
      porTecnico,
      slaEstourado,
      retiradas,
    };

    res.json(metrics);
  }),
);

/**
 * O dia do TECNICO logado. Endpoint proprio, e nao um recorte de /metrics,
 * por tres razoes: o escopo aqui e sempre a propria pessoa, o corte e o dia
 * civil (o de /metrics e o acervo inteiro), e este e chamado a cada abertura
 * do app — precisa ser barato.
 */
dashboardRouter.get(
  "/meu-dia",
  asyncHandler(async (req, res) => {
    const { inicio, fim } = diaBrasileiro(new Date());
    /*
     * `escopoOsWhere` ja resolve o papel: tecnico ve so as dele. Admin/gestor
     * que abrirem isto veem o dia da operacao inteira — nao e a tela deles, mas
     * tambem nao ha o que esconder.
     */
    const doDia = {
      ...escopoOsWhere(req.user!),
      AND: [OS_INTERNA_WHERE],
      dataAgendamento: { gte: inicio, lt: fim },
    };

    // Uma consulta so, agrupada — o app chama isto em toda abertura.
    const grupos = await prisma.ordemServico.groupBy({
      by: ["status"],
      where: doDia,
      _count: { _all: true },
    });
    const por = (...alvos: OsStatus[]) =>
      grupos.filter((g) => alvos.includes(g.status as OsStatus)).reduce((t, g) => t + g._count._all, 0);

    const contagens = {
      programadas: por(OsStatus.ABERTA),
      concluidas: por(OsStatus.CONCLUIDA),
      // Ja saiu do lugar mas nao terminou — o que esta EM ANDAMENTO agora.
      pendentes: por(OsStatus.EM_DESLOCAMENTO, OsStatus.EM_EXECUCAO, OsStatus.PENDENTE),
      naoRealizadas: por(OsStatus.CANCELADA),
    };

    const resumo: MeuDiaResumo = { ...contagens, produtividade: produtividade(contagens) };
    res.json(resumo);
  }),
);

/**
 * A agenda pelo olhar do gestor: quanto da semana ja esta tomado, o que ainda
 * depende de alguem (cliente que nao confirmou, SGP que nao refletiu) e quem
 * esta marcando. O ranking por funcionario le `marcadoPor` (e-mail de quem
 * marcou no painel, nome da atendente vindo do AtendAI); quando nao ha nome, a
 * origem responde — "atendai_ia" e o bot.
 */
dashboardRouter.get(
  "/agenda",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { dias } = z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const hoje = diaBrHoje();
    const fimSemana = somarDias(hoje, 6);
    const desde = new Date(Date.now() - dias * 86_400_000);

    const [ocupacao, semConfirmacaoCliente, pendentesSgp, linhas, semPresenca7d] = await Promise.all([
      agenda.grade({ de: hoje, ate: fimSemana }),
      prisma.agendamento.count({
        where: { status: "marcado", dia: { gte: agenda.dataDoDia(hoje), lte: agenda.dataDoDia(fimSemana) }, confirmadoEm: null },
      }),
      // Mesmo recorte de `confirmarComSgp`: so conta o que ja tem OS ligada,
      // porque marcacao orfa nem teve chance de ser lida de volta.
      prisma.agendamento.count({
        where: { status: "marcado", sgpConfirmadoEm: null, ordemServicoId: { not: null }, dia: { gte: agenda.dataDoDia(hoje) } },
      }),
      prisma.agendamento.groupBy({
        by: ["marcadoPor", "origem", "status"],
        where: { criadoEm: { gte: desde } },
        _count: { _all: true },
      }),
      semPresencaDesde(new Date(Date.now() - 7 * 86_400_000)),
    ]);

    const resposta: DashboardAgenda = {
      dias,
      ocupacao,
      semConfirmacaoCliente,
      pendentesSgp,
      semPresenca7d,
      porFuncionario: agenda.resumirMarcacoes(
        linhas.map((l) => ({ marcadoPor: l.marcadoPor, origem: l.origem, status: l.status, total: l._count._all })),
      ),
    };
    res.json(resposta);
  }),
);
