import { Router } from "express";
import { z } from "zod";
import { TURNOS_AGENDA, UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as agenda from "../services/agendaService.js";
import * as pc from "../services/preCadastroService.js";

/**
 * Pre-cadastro do vendedor em campo. O vendedor so enxerga os PROPRIOS
 * cadastros, e agenda pela rota do pre-cadastro — nunca numa OS qualquer.
 * Gestao (admin/gestor) ve todos e escolhe o provedor.
 */
export const preCadastroRouter = Router();
preCadastroRouter.use(requireAuth, requireRole(UserRole.VENDEDOR, UserRole.ADMIN, UserRole.GESTOR));

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Vendedor: o provedor dele, sempre. Gestao: o que pediu. */
function provedorDe(req: Express.Request, pedido?: string | null): string {
  const u = req.user!;
  if (u.role === UserRole.VENDEDOR) {
    if (!u.provedorId) throw new HttpError(403, "Vendedor sem provedor cadastrado");
    return u.provedorId;
  }
  if (!pedido) throw new HttpError(400, "Informe o provedor");
  return pedido;
}

/** O pre-cadastro, se quem pede pode ve-lo. 404 (e nao 403) para o de outro vendedor. */
async function doUsuario(req: Express.Request, id: string) {
  const u = req.user!;
  const linha = await prisma.preCadastro.findUnique({ where: { id } });
  if (!linha || (u.role === UserRole.VENDEDOR && linha.vendedorId !== u.sub)) throw new HttpError(404, "Pré-cadastro não encontrado");
  return linha;
}

preCadastroRouter.get(
  "/cobertura",
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        provedorId: z.string().optional(),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
        cep: z.string().max(9).optional(),
        endereco: z.string().trim().max(300).optional(),
      })
      .parse(req.query);
    if ((q.lat == null || q.lng == null) && !q.cep && !q.endereco) throw new HttpError(400, "Informe a localização, o CEP ou o endereço");
    res.json(await pc.cobertura(provedorDe(req, q.provedorId), q));
  }),
);

preCadastroRouter.get(
  "/vencimentos",
  asyncHandler(async (req, res) => {
    const { provedorId } = z.object({ provedorId: z.string().optional() }).parse(req.query);
    res.json({ dias: await pc.vencimentos(provedorDe(req, provedorId)) });
  }),
);

const opcional = (max: number) => z.string().trim().max(max).nullish();
/**
 * Obrigatorios (decisao da NetGo): alem do titular e do endereco, e-mail, CEP,
 * celular com WhatsApp e nascimento. Nascimento so para CPF — o SGP nao recebe
 * data de nascimento de empresa.
 */
export const formSchema = z
  .object({
    provedorId: z.string().optional(),
    nome: z.string().trim().min(3, "Informe o nome completo").max(200),
    cpfCnpj: z.string().trim().refine((s) => [11, 14].includes(s.replace(/\D/g, "").length), "CPF ou CNPJ incompleto"),
    nascimento: z.string().trim().max(10).nullish(),
    celular: z.string().trim().refine((s) => /^\d{10,11}$/.test(s.replace(/\D/g, "")), "Celular (WhatsApp) com DDD"),
    email: z.string().trim().email("E-mail inválido").max(200),
    plano: z.object({ id: z.number().int().positive(), nome: z.string().trim().min(1).max(120) }),
    vencimentoDia: z.number().int().min(1).max(31),
    logradouro: z.string().trim().min(2, "Informe a rua").max(200),
    numero: opcional(20),
    complemento: opcional(120),
    referencia: opcional(120),
    bairro: z.string().trim().min(2, "Informe o bairro").max(120),
    cidade: z.string().trim().min(2).max(120),
    uf: z.string().trim().length(2).nullish(),
    cep: z.string().trim().refine((s) => s.replace(/\D/g, "").length === 8, "CEP com 8 números"),
    popId: z.number().int().positive().nullish(),
    portadorId: z.number().int().positive().nullish(),
    nasId: z.number().int().positive().nullish(),
  })
  .refine((f) => f.cpfCnpj.replace(/\D/g, "").length === 14 || /^\d{2}\/\d{2}\/\d{4}$/.test(f.nascimento ?? ""), {
    message: "Informe a data de nascimento (dd/mm/aaaa)",
    path: ["nascimento"],
  });

/** `POST /pre-cadastro` — cadastra no SGP (via AtendAI). O SGP abre a OS de instalacao na mesma chamada. */
preCadastroRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { provedorId, ...form } = formSchema.parse(req.body);
    const linha = await pc.enviar({ provedorId: provedorDe(req, provedorId), vendedorId: req.user!.sub, form });
    res.status(201).json(linha);
  }),
);

/** `GET /pre-cadastro` — os ultimos 30 dias (do vendedor; ou do provedor, para a gestao). */
preCadastroRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const desde = new Date(Date.now() - 30 * 86_400_000);
    const { provedorId } = z.object({ provedorId: z.string().optional() }).parse(req.query);
    const where =
      u.role === UserRole.VENDEDOR
        ? { vendedorId: u.sub, criadoEm: { gte: desde } }
        : { criadoEm: { gte: desde }, ...(provedorId ? { provedorId } : {}) };
    res.json(
      await prisma.preCadastro.findMany({
        where,
        orderBy: { criadoEm: "desc" },
        take: 100,
        include: { vendedor: { select: { nome: true } } },
      }),
    );
  }),
);

/**
 * `GET /pre-cadastro/:id/os` — a OS de instalacao ja apareceu no SGP? Com ela,
 * devolve as proximas vagas da regiao. Uma consulta por chamada; a tela repete.
 */
preCadastroRouter.get(
  "/:id/os",
  asyncHandler(async (req, res) => {
    const linha = await doUsuario(req, req.params.id!);
    const os = await pc.procurarOs(linha);
    if (!os) return res.json({ encontrada: false });
    const vagas = await agenda.proximasVagasDoBanco({ regiao: os.regiao, quantas: 10 });
    res.json({ encontrada: true, sgpOsId: os.sgpOsId, vagas: vagas.map((v) => ({ dia: v.dia, turno: v.turno, livres: v.livres })) });
  }),
);

/** `POST /pre-cadastro/:id/agendar` — marca a instalacao na janela que o cliente escolheu. */
preCadastroRouter.post(
  "/:id/agendar",
  asyncHandler(async (req, res) => {
    const { dia, turno } = z.object({ dia: DIA, turno: z.enum(TURNOS_AGENDA) }).parse(req.body);
    const linha = await doUsuario(req, req.params.id!);
    if (!linha.sgpOsId) throw new HttpError(409, "A OS de instalação ainda não apareceu no SGP.");
    const marcado = await agenda.marcar({
      provedorId: linha.provedorId,
      sgpOsId: linha.sgpOsId,
      dia,
      turno,
      regiao: linha.regiao,
      origem: "isphub",
      marcadoPor: req.user!.email,
      observacao: "Agendado pelo vendedor no pré-cadastro",
    });
    await prisma.preCadastro.update({ where: { id: linha.id }, data: { status: "agendado" } });
    res.status(201).json({ dia, turno, agendamentoId: marcado.id });
    void agenda.enviarAoSgp(marcado.id);
  }),
);
