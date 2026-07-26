import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { OsStatus, OS_STATUS_ABERTOS, UserRole, type FilaItem } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { calcularSla } from "../services/slaService.js";
import { escopoOsWhere } from "../services/escopoService.js";

export const filaRouter = Router();

filaRouter.use(requireAuth);

const filtrosSchema = z.object({
  provedorId: z.string().uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? (s.split(",") as OsStatus[]) : undefined)),
  tipoOsId: z.string().uuid().optional(),
  tecnicoId: z.string().uuid().optional(),
  /** "sem_categoria" filtra OS cujo tipo ainda nao foi mapeado a nenhuma categoria. */
  categoriaId: z.union([z.string().uuid(), z.literal("sem_categoria")]).optional(),
  /**
   * Separa a fila operacional do arquivo. "abertos" = trabalho que ainda
   * precisa de acao (OS em OS_STATUS_ABERTOS / ocorrencia sem data de
   * finalizacao); "fechados" = o resto, so pra consulta. Sem isso, uma base
   * com muita OS encerrada consome o teto de registros e esconde as abertas,
   * que sao justamente as que importam.
   */
  grupo: z.enum(["abertos", "fechados"]).optional(),
  busca: z.string().optional(),
  de: z.string().datetime().optional(),
  ate: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  // Max mais alto que o padrao de paginacao para suportar o Mapa, que precisa
  // de todas as OS geolocalizadas de uma vez (sem paginacao visual propria).
  pageSize: z.coerce.number().int().min(1).max(1000).default(30),
});

/**
 * Fila unificada: mescla Ordens de Servico e Ocorrencias de todos os
 * provedores (ou de um so, via filtro) numa unica lista, com badge do
 * provedor (cor/logo) e SLA calculado por item. Como as duas tabelas nao
 * compartilham schema, a paginacao e feita em memoria apos buscar um
 * volume generoso de cada uma — adequado para o volume esperado no MVP;
 * se a escala crescer muito, migrar para uma view/union SQL dedicada.
 */
filaRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const f = filtrosSchema.parse(req.query);

    // provedor: so o proprio provedor. tecnico: so as OS atribuidas a ele
    // mesmo (de qualquer provedor). admin/gestor: livre, com filtro opcional.
    const osWhere: any = { ...escopoOsWhere(req.user!, f.provedorId) };
    if (f.status?.length) osWhere.status = { in: f.status };
    else if (f.grupo === "abertos") osWhere.status = { in: OS_STATUS_ABERTOS };
    else if (f.grupo === "fechados") osWhere.status = { notIn: OS_STATUS_ABERTOS };
    if (f.tipoOsId) osWhere.tipoOsId = f.tipoOsId;
    // Filtro de tecnicoId da query so vale pra admin/gestor escolhendo um
    // tecnico especifico — um usuario tecnico nao pode usa-lo pra ver a fila
    // de outro tecnico, o escopo acima ja fixou o dele.
    if (f.tecnicoId && req.user!.role !== UserRole.TECNICO) osWhere.tecnicoId = f.tecnicoId;
    if (f.categoriaId === "sem_categoria") osWhere.tipoOs = { categoriaId: null };
    else if (f.categoriaId) osWhere.tipoOs = { categoriaId: f.categoriaId };
    if (f.de || f.ate) {
      osWhere.dataAgendamento = {};
      if (f.de) osWhere.dataAgendamento.gte = new Date(f.de);
      if (f.ate) osWhere.dataAgendamento.lte = new Date(f.ate);
    }
    if (f.busca) {
      osWhere.OR = [
        { clienteNome: { contains: f.busca, mode: "insensitive" } },
        { protocolo: { contains: f.busca, mode: "insensitive" } },
        { logradouro: { contains: f.busca, mode: "insensitive" } },
        { contratoId: { contains: f.busca, mode: "insensitive" } },
      ];
    }
    Object.keys(osWhere).forEach((k) => osWhere[k] === undefined && delete osWhere[k]);

    const ordens = await prisma.ordemServico.findMany({
      where: osWhere,
      include: { provedor: true, tipoOs: { include: { categoria: true } }, tecnico: true },
      orderBy: [{ dataAgendamento: "asc" }, { criadoEm: "desc" }],
      take: 500,
    });

    // Ocorrencias so entram na fila quando o filtro nao usa dimensoes
    // exclusivas de OS (tipo/tecnico/categoria), que elas nao possuem, e
    // nunca pra um usuario tecnico (ocorrencia nao tem tecnico atribuido —
    // a fila dele e so as OS dele mesmo).
    let ocorrencias: Prisma.OcorrenciaGetPayload<{ include: { provedor: true } }>[] = [];
    if (req.user!.role !== UserRole.TECNICO && !f.tipoOsId && !f.tecnicoId && !f.categoriaId) {
      const provedorIdOcorrencias =
        req.user!.role === UserRole.PROVEDOR ? (req.user!.provedorId ?? "__nenhum__") : f.provedorId;
      const ocoWhere: any = { provedorId: provedorIdOcorrencias };
      // Coerencia com o grupo pedido: ocorrencia "aberta" e a que ainda nao
      // tem data de finalizacao (o SGP nao expoe um enum de status util aqui).
      if (f.grupo === "abertos") ocoWhere.dataFinalizacao = null;
      else if (f.grupo === "fechados") ocoWhere.dataFinalizacao = { not: null };
      if (f.busca) {
        ocoWhere.OR = [
          { conteudo: { contains: f.busca, mode: "insensitive" } },
          { contratoId: { contains: f.busca, mode: "insensitive" } },
          { sgpNumero: { contains: f.busca, mode: "insensitive" } },
        ];
      }
      if (f.de || f.ate) {
        ocoWhere.dataCadastro = {};
        if (f.de) ocoWhere.dataCadastro.gte = new Date(f.de);
        if (f.ate) ocoWhere.dataCadastro.lte = new Date(f.ate);
      }
      Object.keys(ocoWhere).forEach((k) => ocoWhere[k] === undefined && delete ocoWhere[k]);

      ocorrencias = await prisma.ocorrencia.findMany({
        where: ocoWhere,
        include: { provedor: true },
        orderBy: { dataCadastro: "desc" },
        take: 500,
      });
    }

    const itensOs: FilaItem[] = ordens.map((os) => ({
      kind: "os" as const,
      id: os.id,
      provedorId: os.provedorId,
      provedor: {
        id: os.provedor.id,
        nome: os.provedor.nome,
        cor: os.provedor.cor,
        logoUrl: os.provedor.logoUrl,
        ativo: os.provedor.ativo,
        criadoEm: os.provedor.criadoEm.toISOString(),
      },
      sgpOsId: os.sgpOsId,
      tipoOsId: os.tipoOsId,
      tipoDescricao: os.tipoOs?.descricao ?? null,
      categoria: os.tipoOs?.categoria
        ? {
            id: os.tipoOs.categoria.id,
            nome: os.tipoOs.categoria.nome,
            cor: os.tipoOs.categoria.cor,
            icone: os.tipoOs.categoria.icone,
            slaHorasPadrao: os.tipoOs.categoria.slaHorasPadrao,
          }
        : null,
      status: os.status as OsStatus,
      prioridade: os.prioridade as 1 | 2 | 3,
      clienteNome: os.clienteNome,
      clienteDocumento: os.clienteDocumento,
      contratoId: os.contratoId,
      contratoStatus: os.contratoStatus,
      protocolo: os.protocolo,
      conteudo: os.conteudo,
      observacao: os.observacao,
      endereco: {
        logradouro: os.logradouro,
        numero: os.numero,
        bairro: os.bairro,
        cidade: os.cidade,
        lat: os.lat,
        lng: os.lng,
      },
      pop: os.pop,
      usuario: os.usuario,
      dataCadastro: os.dataCadastro?.toISOString() ?? null,
      dataAgendamento: os.dataAgendamento?.toISOString() ?? null,
      tecnicoId: os.tecnicoId,
      tecnicoNome: os.tecnico?.nome ?? null,
      tecnicoSgpNome: os.tecnicoSgpNome,
      criadoEm: os.criadoEm.toISOString(),
      atualizadoEm: os.atualizadoEm.toISOString(),
      sincronizadoEm: os.sincronizadoEm.toISOString(),
      // dataCadastro (data real de abertura no SGP) e uma base de SLA mais
      // fiel que criadoEm, que so reflete quando o ISPhub sincronizou pela
      // primeira vez — importante pra OS antigas importadas so agora.
      // SLA efetivo: o do tipo, com fallback pro padrao da categoria (menos
      // configuracao manual por tipo — so precisa mexer quando o tipo foge
      // do padrao da propria categoria).
      sla: calcularSla({
        slaHoras: os.tipoOs?.slaHoras ?? os.tipoOs?.categoria?.slaHorasPadrao,
        dataBase: os.dataAgendamento ?? os.dataCadastro ?? os.criadoEm,
      }),
    }));

    const itensOco: FilaItem[] = ocorrencias.map((o) => ({
      kind: "ocorrencia" as const,
      id: o.id,
      provedorId: o.provedorId,
      provedor: {
        id: o.provedor.id,
        nome: o.provedor.nome,
        cor: o.provedor.cor,
        logoUrl: o.provedor.logoUrl,
        ativo: o.provedor.ativo,
        criadoEm: o.provedor.criadoEm.toISOString(),
      },
      sgpNumero: o.sgpNumero,
      tipo: o.tipo,
      status: o.status,
      conteudo: o.conteudo,
      responsavel: o.responsavel,
      clienteNome: o.clienteNome,
      contratoId: o.contratoId,
      contratoStatus: o.contratoStatus,
      pop: o.pop,
      metodo: o.metodo,
      usuario: o.usuario,
      dataCadastro: o.dataCadastro?.toISOString() ?? null,
      dataAgendamento: o.dataAgendamento?.toISOString() ?? null,
      dataFinalizacao: o.dataFinalizacao?.toISOString() ?? null,
      sincronizadoEm: o.sincronizadoEm.toISOString(),
    }));

    /** Data mais relevante de um item, para ordenar a fila mesclada (mais recente primeiro). */
    function dataRelevante(item: FilaItem): string {
      if (item.kind === "os") return item.dataAgendamento ?? item.criadoEm;
      return item.dataAgendamento ?? item.dataCadastro ?? "";
    }

    const todos = [...itensOs, ...itensOco].sort((a, b) => dataRelevante(b).localeCompare(dataRelevante(a)));

    const start = (f.page - 1) * f.pageSize;
    const pagina = todos.slice(start, start + f.pageSize);

    // Contagem real por grupo, direto do banco: os contadores das abas nao
    // podem depender do que coube no `take`, senao voltam a mentir quando a
    // base cresce (foi assim que 1000 OS encerradas se passaram por abertas).
    // Ignora o filtro de grupo/status, mas respeita escopo e demais filtros.
    const osWhereSemStatus = { ...osWhere };
    delete osWhereSemStatus.status;
    const [osAbertas, osFechadas, abertasComSla] = await Promise.all([
      prisma.ordemServico.count({ where: { ...osWhereSemStatus, status: { in: OS_STATUS_ABERTOS } } }),
      prisma.ordemServico.count({ where: { ...osWhereSemStatus, status: { notIn: OS_STATUS_ABERTOS } } }),
      // Só os campos que o SLA precisa — o alerta tem que ser o mesmo esteja
      // o usuario na aba de abertas ou na de concluidas.
      prisma.ordemServico.findMany({
        where: { ...osWhereSemStatus, status: { in: OS_STATUS_ABERTOS } },
        select: {
          dataAgendamento: true,
          dataCadastro: true,
          criadoEm: true,
          tipoOs: { select: { slaHoras: true, categoria: { select: { slaHorasPadrao: true } } } },
        },
      }),
    ]);

    const osSlaEstourado = abertasComSla.filter(
      (os) =>
        calcularSla({
          slaHoras: os.tipoOs?.slaHoras ?? os.tipoOs?.categoria?.slaHorasPadrao,
          dataBase: os.dataAgendamento ?? os.dataCadastro ?? os.criadoEm,
        }).semaforo === "vermelho",
    ).length;

    res.json({
      total: todos.length,
      page: f.page,
      pageSize: f.pageSize,
      itens: pagina,
      totais: { osAbertas, osFechadas, osSlaEstourado },
    });
  }),
);
