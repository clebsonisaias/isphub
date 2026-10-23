import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { EMOJIS_REACAO, MensagemTipo, UserRole } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as chatService from "../services/chatService.js";
import { contatosAtendai, conversaComAtendente } from "../services/ponteChatAtendaiService.js";
import { prisma } from "../lib/prisma.js";

export const chatRouter = Router();

chatRouter.use(requireAuth);

/** Trava contra flood (bug de retry no cliente ou abuso) — por usuario, nao por IP. */
const enviarMensagemLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.sub,
  message: { error: "Muitas mensagens em pouco tempo. Aguarde um instante." },
});

/**
 * Reacoes sao baratas de mandar e criam linha no banco — sem limite proprio,
 * um loop enchia a tabela indefinidamente. Teto mais alto que o de mensagem
 * porque reagir em varias mensagens seguidas e uso normal.
 */
const reagirLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.sub,
  message: { error: "Muitas reacoes em pouco tempo. Aguarde um instante." },
});

/**
 * Resposta rapida NAO e texto: escreve status na OS e no SGP do provedor, e
 * "preciso de apoio" notifica todo admin/gestor. Estava fora de qualquer
 * limite — era o caminho mais barato pra floodar notificacao e martelar o SGP
 * de um provedor. Teto baixo de proposito: no uso real sao poucos cliques.
 */
const respostaRapidaLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.sub,
  message: { error: "Muitas acoes em pouco tempo. Aguarde um instante." },
});

/** PROVEDOR nunca chega no chat — bloqueado antes de qualquer rota abaixo. */
chatRouter.use((req, _res, next) => {
  if (req.user!.role === UserRole.PROVEDOR) throw new HttpError(403, "Chat nao disponivel para este papel");
  next();
});

chatRouter.get(
  "/contatos",
  asyncHandler(async (req, res) => {
    res.json(await chatService.listarContatos(req.user!.sub));
  }),
);

chatRouter.get(
  "/conversas",
  asyncHandler(async (req, res) => {
    res.json(await chatService.listarConversas(req.user!.sub));
  }),
);

/** Atendentes do AtendAI (provedores com o chat ligado) — para abrir conversa com elas. */
chatRouter.get(
  "/atendai/contatos",
  asyncHandler(async (_req, res) => {
    res.json(await contatosAtendai());
  }),
);

/** Conversa direta com uma atendente do AtendAI: nasce la e espelha aqui. */
chatRouter.post(
  "/conversas/atendai",
  asyncHandler(async (req, res) => {
    const b = z
      .object({ provedorId: z.string().uuid(), colaboradorId: z.string().min(1).max(64), nome: z.string().trim().min(1).max(120) })
      .parse(req.body);
    const eu = await prisma.usuario.findUniqueOrThrow({ where: { id: req.user!.sub }, select: { id: true, nome: true, role: true } });
    res.status(201).json(await conversaComAtendente(eu, b.provedorId, b.colaboradorId, b.nome));
  }),
);

/** Endpoint leve pro badge do sino do chat — so o total, sem montar as conversas. */
chatRouter.get(
  "/nao-lidas",
  asyncHandler(async (req, res) => {
    res.json({ naoLidas: await chatService.contarNaoLidas(req.user!.sub) });
  }),
);

chatRouter.post(
  "/conversas/avisos",
  asyncHandler(async (req, res) => {
    res.status(201).json(await chatService.garantirConversaAvisos(req.user!.sub));
  }),
);

const criarDiretaSchema = z.object({ usuarioId: z.string().min(1) });

chatRouter.post(
  "/conversas/direta",
  asyncHandler(async (req, res) => {
    const { usuarioId } = criarDiretaSchema.parse(req.body);
    res.status(201).json(await chatService.criarOuObterConversaDireta(req.user!.sub, usuarioId));
  }),
);

const criarGrupoSchema = z.object({
  titulo: z.string().trim().min(1).max(80),
  participanteIds: z.array(z.string().min(1)).min(1),
});

chatRouter.post(
  "/conversas/grupo",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { titulo, participanteIds } = criarGrupoSchema.parse(req.body);
    res.status(201).json(await chatService.criarConversaGrupo(titulo, participanteIds, req.user!.sub));
  }),
);

chatRouter.post(
  "/conversas/os/:ordemServicoId",
  asyncHandler(async (req, res) => {
    res.status(201).json(await chatService.garantirConversaDeOs(req.user!, req.params.ordemServicoId));
  }),
);

const listarMensagensSchema = z.object({
  antesDe: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

chatRouter.get(
  "/conversas/:conversaId/mensagens",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const { antesDe, limit } = listarMensagensSchema.parse(req.query);
    res.json(await chatService.listarMensagens(req.params.conversaId, antesDe, limit));
  }),
);

const enviarMensagemSchema = z.object({
  // `sistema` fica DE FORA de proposito: mensagem de sistema so nasce no
  // servidor (aplicarRespostaRapidaOs). Quando o cliente podia manda-la, um
  // tecnico publicava aviso sem autor no canal da empresa toda — os dois
  // clientes desenham SISTEMA como pilula centralizada, sem nome nem avatar.
  tipo: z
    .nativeEnum(MensagemTipo)
    .refine((t) => t !== MensagemTipo.SISTEMA, { message: "Tipo de mensagem invalido" })
    .default(MensagemTipo.TEXTO),
  corpo: z.string().trim().min(1).max(4000).optional(),
  anexoBase64: z.string().optional(),
  anexoMime: z.string().optional(),
  duracaoSeg: z.number().int().positive().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  ordemServicoRefId: z.string().optional(),
  respondendoAId: z.string().optional(),
});

chatRouter.post(
  "/conversas/:conversaId/mensagens",
  enviarMensagemLimiter,
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const input = enviarMensagemSchema.parse(req.body);
    res.status(201).json(await chatService.enviarMensagem(req.params.conversaId, req.user!.sub, input));
  }),
);

chatRouter.post(
  "/conversas/:conversaId/leitura",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    await chatService.marcarLida(req.params.conversaId, req.user!.sub);
    res.status(204).send();
  }),
);

chatRouter.post(
  "/conversas/:conversaId/digitando",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    await chatService.emitirDigitando(req.params.conversaId, req.user!.sub);
    res.status(204).send();
  }),
);

const respostaRapidaSchema = z.object({
  tipo: z.enum(["a_caminho", "cheguei", "cliente_ausente", "preciso_apoio"]),
});

chatRouter.post(
  "/conversas/:conversaId/os/resposta-rapida",
  respostaRapidaLimiter,
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const { tipo } = respostaRapidaSchema.parse(req.body);
    res.status(201).json(await chatService.aplicarRespostaRapidaOs(req.user!, req.params.conversaId, tipo));
  }),
);

const reagirSchema = z.object({ emoji: z.enum(EMOJIS_REACAO) });

chatRouter.post(
  "/conversas/:conversaId/mensagens/:mensagemId/reagir",
  reagirLimiter,
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const { emoji } = reagirSchema.parse(req.body);
    // conversaId vai junto: amarra a mensagem A ESTA conversa (a que acabou de
    // passar por exigirParticipacao), senao participar de uma autoriza reagir
    // na mensagem de outra.
    await chatService.reagir(req.params.conversaId, req.params.mensagemId, req.user!.sub, emoji);
    res.status(204).send();
  }),
);

const editarMensagemSchema = z.object({ corpo: z.string().trim().min(1).max(4000) });

chatRouter.patch(
  "/conversas/:conversaId/mensagens/:mensagemId",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const { corpo } = editarMensagemSchema.parse(req.body);
    res.json(await chatService.editarMensagem(req.params.mensagemId, req.user!.sub, corpo));
  }),
);

chatRouter.delete(
  "/conversas/:conversaId/mensagens/:mensagemId",
  asyncHandler(async (req, res) => {
    await chatService.exigirParticipacao(req.user!, req.params.conversaId);
    const ehAdmin = req.user!.role === UserRole.ADMIN;
    await chatService.apagarMensagem(req.params.mensagemId, req.user!.sub, ehAdmin);
    res.status(204).send();
  }),
);

/** Bytes de foto/audio — existencia primeiro, participacao so depois (mesma ordem de obterArquivoEvidencia). */
chatRouter.get(
  "/mensagens/:mensagemId/anexo",
  asyncHandler(async (req, res) => {
    const anexo = await chatService.obterAnexo(req.params.mensagemId);
    if (!anexo) throw new HttpError(404, "Anexo nao encontrado");
    await chatService.exigirParticipacao(req.user!, anexo.conversaId);
    res.setHeader("Content-Type", anexo.mime);
    res.send(anexo.dados);
  }),
);
