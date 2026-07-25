import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { CategoriaTipoOs, OsStatus, UserRole, type FilaItem } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { calcularSla } from "../services/slaService.js";

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
  categoria: z.enum(["ocorrencia", "instalacao"]).optional(),
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

    // role=provedor so enxerga o proprio provedor, nunca a fila geral.
    const provedorId = req.user!.role === UserRole.PROVEDOR ? req.user!.provedorId ?? "__nenhum__" : f.provedorId;

    const osWhere: any = { provedorId };
    if (f.status?.length) osWhere.status = { in: f.status };
    if (f.tipoOsId) osWhere.tipoOsId = f.tipoOsId;
    if (f.tecnicoId) osWhere.tecnicoId = f.tecnicoId;
    if (f.categoria) osWhere.tipoOs = { categoria: f.categoria };
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
      include: { provedor: true, tipoOs: true, tecnico: true },
      orderBy: [{ dataAgendamento: "asc" }, { criadoEm: "desc" }],
      take: 500,
    });

    // Ocorrencias so entram na fila quando o filtro nao usa dimensoes
    // exclusivas de OS (tipo/tecnico/categoria), que elas nao possuem.
    let ocorrencias: Prisma.OcorrenciaGetPayload<{ include: { provedor: true } }>[] = [];
    if (!f.tipoOsId && !f.tecnicoId && !f.categoria) {
      const ocoWhere: any = { provedorId };
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
      categoria: (os.tipoOs?.categoria as CategoriaTipoOs | undefined) ?? null,
      status: os.status as OsStatus,
      prioridade: os.prioridade as 1 | 2 | 3,
      clienteNome: os.clienteNome,
      clienteDocumento: os.clienteDocumento,
      contratoId: os.contratoId,
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
      dataAgendamento: os.dataAgendamento?.toISOString() ?? null,
      tecnicoId: os.tecnicoId,
      tecnicoNome: os.tecnico?.nome ?? null,
      criadoEm: os.criadoEm.toISOString(),
      atualizadoEm: os.atualizadoEm.toISOString(),
      sincronizadoEm: os.sincronizadoEm.toISOString(),
      sla: calcularSla({ slaHoras: os.tipoOs?.slaHoras, dataBase: os.dataAgendamento ?? os.criadoEm }),
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
      contratoId: o.contratoId,
      dataCadastro: o.dataCadastro?.toISOString() ?? null,
      dataAgendamento: o.dataAgendamento?.toISOString() ?? null,
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

    res.json({ total: todos.length, page: f.page, pageSize: f.pageSize, itens: pagina });
  }),
);
