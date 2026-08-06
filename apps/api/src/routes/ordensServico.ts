import { Router } from "express";
import { z } from "zod";
import { OsStatus, UserRole, ehCodigoStatusContrato, type CodigoStatusContrato } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { podeAcessarOs } from "../services/escopoService.js";
import * as writeback from "../services/writebackService.js";

export const ordensServicoRouter = Router();

ordensServicoRouter.use(requireAuth);

async function assertAcesso(req: any, ordemServicoId: string) {
  const os = await prisma.ordemServico.findUnique({ where: { id: ordemServicoId } });
  if (!os) throw new HttpError(404, "Ordem de servico nao encontrada");
  if (!podeAcessarOs(req.user, os)) {
    throw new HttpError(403, "Acesso restrito ao proprio provedor/tecnico");
  }
  return os;
}

/**
 * Ficha completa da OS lida AO VIVO do SGP. Rota SEPARADA do `GET /:id` de
 * proposito: o detalhe vem do espelho local e abre na hora, enquanto isto
 * depende do SGP do provedor. Junto, toda abertura de OS ficaria presa
 * esperando o ERP — mesmo desenho do /conexao/:contratoId/detalhes.
 *
 * `null` quando o SGP nao devolve a OS ou falha: a tela segue funcionando com
 * o espelho.
 */
ordensServicoRouter.get(
  "/:id/ficha-sgp",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    res.json(await writeback.obterFichaSgp(req.params.id));
  }),
);

ordensServicoRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const os = await prisma.ordemServico.findUnique({
      where: { id: req.params.id },
      include: { provedor: true, tipoOs: true, tecnico: true, atribuicoes: { orderBy: { atribuidoEm: "desc" } } },
    });
    // Aninha `endereco` (colunas planas no banco) pra bater com o tipo
    // OrdemServico do shared que os clientes consomem (o app mobile lê
    // os.endereco.logradouro). Aditivo: os campos planos seguem presentes.
    res.json(
      os && {
        ...os,
        endereco: { logradouro: os.logradouro, numero: os.numero, bairro: os.bairro, cidade: os.cidade, lat: os.lat, lng: os.lng },
      },
    );
  }),
);

const acoesRoles = [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO];

ordensServicoRouter.post(
  "/:id/acaminho",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const os = await writeback.marcarACaminho(req.params.id, req.user!.sub);
    res.json(os);
  }),
);

const statusSchema = z.object({ status: z.nativeEnum(OsStatus) });

ordensServicoRouter.patch(
  "/:id/status",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { status } = statusSchema.parse(req.body);
    const os = await writeback.mudarStatus(req.params.id, status, req.user!.sub);
    res.json(os);
  }),
);

const contratoStatusSchema = z.object({
  status: z.number().int().refine(ehCodigoStatusContrato, "Codigo de status de contrato invalido (use 1..7)"),
});

/**
 * Muda o status do CONTRATO no SGP (nao o da OS).
 *
 * `requireRole` aqui e so a porta grossa — quem decide de verdade e o service,
 * porque o papel SOZINHO nao responde: o tecnico pode ou nao pode dependendo do
 * status ATUAL do contrato. Deixar a decisao no middleware obrigaria a carregar
 * a OS duas vezes ou a duplicar a regra.
 */
ordensServicoRouter.post(
  "/:id/contrato-status",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { status } = contratoStatusSchema.parse(req.body);
    const os = await writeback.alterarStatusContrato(
      req.params.id,
      status as CodigoStatusContrato,
      req.user!.sub,
      req.user!.role,
    );
    res.json(os);
  }),
);

const anotacaoSchema = z.object({ texto: z.string().min(1).max(2000) });

ordensServicoRouter.post(
  "/:id/anotacoes",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { texto } = anotacaoSchema.parse(req.body);
    const os = await writeback.adicionarAnotacao(req.params.id, texto, req.user!.sub);
    res.json(os);
  }),
);

const atribuirSchema = z.object({ tecnicoId: z.string().uuid() });

ordensServicoRouter.post(
  "/:id/atribuir",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { tecnicoId } = atribuirSchema.parse(req.body);
    const os = await writeback.atribuirTecnico(req.params.id, tecnicoId, req.user!.sub);
    res.json(os);
  }),
);

/** Timeline da OS: status, anotacoes, atribuicoes e fotos, mais recentes primeiro. */
ordensServicoRouter.get(
  "/:id/eventos",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const eventos = await prisma.osEvento.findMany({
      where: { ordemServicoId: req.params.id },
      include: { autor: { select: { nome: true } } },
      orderBy: { criadoEm: "desc" },
    });
    res.json(
      eventos.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        autorNome: e.autor?.nome ?? null,
        descricao: e.descricao,
        criadoEm: e.criadoEm,
      })),
    );
  }),
);

const EVIDENCIA_TAMANHO_MAX_BYTES = 2 * 1024 * 1024;
const MIME_TYPES_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"] as const;

const evidenciaSchema = z.object({
  /** Base64 puro, sem o prefixo "data:...;base64,". Comprimida no cliente antes do envio. */
  dados: z.string().min(1),
  mimeType: z.enum(MIME_TYPES_PERMITIDOS),
  legenda: z.string().max(500).optional(),
});

/**
 * Fotos de evidencia sao hospedadas no proprio SGP (nao ha storage local) —
 * essas 3 rotas so validam/repassam pro conector; ver writebackService.ts.
 */
/**
 * O teto de corpo desta rota (4MB, pra caber foto de 2MB em base64) e montado
 * em app.ts ANTES do express.json global — um parser declarado aqui seria
 * no-op, porque o global ja teria marcado `req._body`. O tamanho real da foto
 * ainda e validado abaixo, em bytes decodificados.
 */
ordensServicoRouter.post(
  "/:id/evidencias",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { dados, legenda } = evidenciaSchema.parse(req.body);

    // So valida o tamanho antes de mandar pro SGP (mimeType em si o SGP nao pede).
    const tamanhoBytes = Buffer.byteLength(dados, "base64");
    if (tamanhoBytes === 0) throw new HttpError(400, "Arquivo vazio ou base64 invalido");
    if (tamanhoBytes > EVIDENCIA_TAMANHO_MAX_BYTES) {
      throw new HttpError(400, `Foto maior que o limite de ${EVIDENCIA_TAMANHO_MAX_BYTES / 1024 / 1024}MB`);
    }

    const imagens = await writeback.adicionarEvidencia(req.params.id, dados, req.user!.sub, legenda);
    res.status(201).json(imagens);
  }),
);

ordensServicoRouter.get(
  "/:id/evidencias",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    res.json(await writeback.listarEvidencias(req.params.id));
  }),
);

ordensServicoRouter.get(
  "/:id/evidencias/:anexoId/arquivo",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    // `anexoId` e um id sequencial do SGP. Sem amarrar o anexo A ESTA OS, quem
    // tem UMA OS legitima itera 1..N e baixa a foto de qualquer OS daquele
    // provedor (IDOR). A lista ja e escopada pela OS — ela e a autorizacao.
    const evidencias = await writeback.listarEvidencias(req.params.id);
    if (!evidencias.some((e) => String(e.id) === String(req.params.anexoId))) {
      throw new HttpError(404, "Evidencia nao encontrada");
    }

    const arquivo = await writeback.obterArquivoEvidencia(req.params.id, req.params.anexoId);
    if (!arquivo) throw new HttpError(404, "Evidencia nao encontrada");
    res.setHeader("Content-Type", arquivo.contentType);
    // Defesa em profundidade junto do sniff de bytes no conector: mesmo que um
    // tipo inesperado escape, o browser baixa em vez de renderizar na origem.
    res.setHeader("Content-Disposition", "attachment");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(arquivo.bytes));
  }),
);
