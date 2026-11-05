import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { OsStatus, UserRole, ehCodigoStatusContrato, type CodigoStatusContrato } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { calcularDeslocamentoOs, deslocamentoDaOs } from "../services/deslocamentoService.js";
import { auditarOs, auditoriaDaOs } from "../services/auditoriaVisitaService.js";
import { geoSchema } from "../lib/geo.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { podeAcessarOs } from "../services/escopoService.js";
import * as writeback from "../services/writebackService.js";
import { INCLUDE_FILA, paraFilaItem } from "./fila.js";
import { iniciarComClienteDaOs } from "../services/clienteAtendaiService.js";
import * as agendaService from "../services/agendaService.js";
import { montarTimeline } from "../lib/eventosAgenda.js";

export const ordensServicoRouter = Router();

ordensServicoRouter.use(requireAuth);

async function assertAcesso(req: any, ordemServicoId: string) {
  const os = await prisma.ordemServico.findUnique({
    where: { id: ordemServicoId },
    include: { apoios: { select: { id: true } } },
  });
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
      include: { ...INCLUDE_FILA, atribuicoes: { orderBy: { atribuidoEm: "desc" } } },
    });
    // A mesma forma da fila (FilaItem: endereco aninhado, categoria, sla,
    // agenda) por cima das colunas planas e relacoes cruas: a tela /os/:id
    // reusa o detalhe da fila, e o app mobile le os.endereco.logradouro.
    // Aditivo — nada que ja era devolvido some.
    res.json(os && { ...os, ...paraFilaItem(os) });
  }),
);

const acoesRoles = [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO];

/**
 * "Conversar com o cliente": abre (ou retoma) a conversa com o cliente da OS
 * pelo WhatsApp do AtendAI do provedor e devolve o id para abrir o chat. So o
 * telefone da propria OS; limite por pessoa, porque cada abertura manda mensagem.
 */
ordensServicoRouter.post(
  "/:id/conversa-cliente",
  requireRole(...acoesRoles, UserRole.ATENDENTE),
  rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user!.sub,
    message: { error: "Muitas conversas abertas em pouco tempo. Aguarde um instante." },
  }),
  asyncHandler(async (req, res) => {
    const { texto } = z.object({ texto: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
    res.json(await iniciarComClienteDaOs(req.user!, req.params.id, texto));
  }),
);

/**
 * Encerra a OS sem visita (a internet voltou, o cliente desistiu...), pela tela
 * de marcar. Motivo obrigatorio: vai para o SGP junto com o nome de quem encerrou.
 */
ordensServicoRouter.post(
  "/:id/encerrar",
  requireRole(UserRole.ADMIN, UserRole.GESTOR, UserRole.ATENDENTE),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { motivo } = z
      .object({ motivo: z.string().trim().min(10, "Escreva o motivo (pelo menos 10 letras)").max(500) })
      .parse(req.body ?? {});
    res.json(await writeback.encerrarSemVisita(req.params.id, motivo, req.user!.sub));
  }),
);

ordensServicoRouter.post(
  "/:id/acaminho",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    // O corpo era IGNORADO (rota sem schema). Agora carrega a posicao de onde o
    // tecnico disse que saiu — opcional, ver lib/geo.ts.
    const geo = geoSchema.parse(req.body ?? {});
    const os = await writeback.marcarACaminho(req.params.id, req.user!.sub, geo);
    res.json(os);
  }),
);

// `.merge` com o geo: a mudanca de status carrega de ONDE ela foi feita —
// "chegou" (em execucao) e "concluiu" sao dois dos tres momentos que interessam.
// `servicoPrestado`: "o que foi feito", vai pro SGP ao concluir/cancelar.
const statusSchema = z
  .object({ status: z.nativeEnum(OsStatus), servicoPrestado: z.string().trim().max(2000).optional() })
  .merge(geoSchema);

ordensServicoRouter.patch(
  "/:id/status",
  requireRole(...acoesRoles),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { status, servicoPrestado, ...geo } = statusSchema.parse(req.body);
    const os = await writeback.mudarStatus(req.params.id, status, req.user!.sub, geo, servicoPrestado);
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

/**
 * Quanto a viatura rodou ate esta OS. `?calcular=1` (admin/gestor) força o
 * recalculo — serve pra OS que fechou agora e ainda nao entrou no job.
 */
ordensServicoRouter.get(
  "/:id/deslocamento",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const forcar = req.query.calcular === "1" && (req.user!.role === UserRole.ADMIN || req.user!.role === UserRole.GESTOR);
    const atual = forcar ? null : await deslocamentoDaOs(req.params.id);
    res.json(atual ?? (await calcularDeslocamentoOs(req.params.id)));
  }),
);

/** A viatura esteve no endereco? `?auditar=1` (admin/gestor) força. `null` = OS nao concluida. */
ordensServicoRouter.get(
  "/:id/auditoria",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const forcar = req.query.auditar === "1" && (req.user!.role === UserRole.ADMIN || req.user!.role === UserRole.GESTOR);
    const atual = forcar ? null : await auditoriaDaOs(req.params.id);
    res.json(atual ?? (await auditarOs(req.params.id)));
  }),
);

/** Timeline da OS: status, anotacoes, atribuicoes e fotos, mais recentes primeiro. */
ordensServicoRouter.get(
  "/:id/eventos",
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const [eventos, os] = await Promise.all([
      prisma.osEvento.findMany({
        where: { ordemServicoId: req.params.id },
        include: { autor: { select: { nome: true } } },
        orderBy: { criadoEm: "desc" },
      }),
      prisma.ordemServico.findUnique({
        where: { id: req.params.id },
        select: { provedorId: true, sgpOsId: true, usuario: true, dataCadastro: true },
      }),
    ]);
    // Trilha da agenda e da abertura: chaveada pelo id do SGP, existe mesmo antes de a OS espelhar.
    const agendaEventos = os ? await agendaService.eventosDaOs(os.provedorId, os.sgpOsId) : [];
    res.json(
      montarTimeline(
        /*
         * Projecao campo a campo — lista de permissao, nao de exclusao. Campo
         * novo no modelo que nao seja acrescentado AQUI simplesmente nao chega
         * na tela, sem erro nenhum em lugar nenhum.
         */
        eventos.map((e) => ({
          id: e.id,
          tipo: e.tipo,
          autorNome: e.autor?.nome ?? null,
          descricao: e.descricao,
          lat: e.lat,
          lng: e.lng,
          criadoEm: e.criadoEm.toISOString(),
        })),
        agendaEventos,
        { usuario: os?.usuario ?? null, dataCadastro: os?.dataCadastro ?? null },
      ),
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
