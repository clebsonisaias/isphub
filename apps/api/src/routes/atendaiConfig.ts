import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { decrypt, encrypt, maskToken } from "../lib/crypto.js";
import { validarUrlExterna } from "../lib/urlValidation.js";
import { chamar, credencialDoProvedor } from "../services/atendaiService.js";
import { gerarChaveEntrada, revogarChaveEntrada } from "../services/chaveParceiroService.js";

/**
 * Cadastro da ligacao de um provedor com o AtendAI.
 *
 * Espelha `erpConfig.ts` de proposito: e o mesmo problema (credencial de
 * sistema externo, por provedor, que nunca pode voltar em GET), e resolver de
 * outro jeito daria dois padroes de segredo pra manter.
 */
export const atendaiConfigRouter = Router({ mergeParams: true });

atendaiConfigRouter.use(requireAuth, requireRole(UserRole.ADMIN, UserRole.GESTOR));

const salvarSchema = z.object({
  baseUrl: z.string().url().superRefine(validarUrlExterna),
  /** `ak_…`. Minimo generoso: chave curta demais nao e chave. */
  chave: z.string().min(12),
  ativo: z.boolean().optional(),
});

atendaiConfigRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const row = await prisma.atendaiConfig.findUnique({ where: { provedorId: req.params.provedorId! } });
    if (!row) return res.json(null);

    let chaveMascarada = "****";
    try {
      chaveMascarada = maskToken(decrypt(row.chaveCifrada));
    } catch {
      // chave ilegivel nao interrompe a tela — so nao mascara de forma util
    }
    // A chave NUNCA volta inteira, e o segredo do webhook nem mascarado: ele so
    // serve pra validar assinatura no servidor, ninguem precisa ve-lo.
    res.json({
      id: row.id,
      baseUrl: row.baseUrl,
      chaveMascarada,
      temSegredoWebhook: !!row.segredoCifrado,
      ativo: row.ativo,
      // A chave de ENTRADA (a que o AtendAI usa pra agendar aqui) nunca volta,
      // nem mascarada: ela e hash, entao nem o servidor a conhece. So o
      // prefixo, que identifica QUAL chave esta ativa sem revelar nenhuma.
      chaveEntradaPrefixo: row.chaveEntradaPrefixo,
      chaveEntradaUsoEm: row.chaveEntradaUsoEm,
    });
  }),
);

atendaiConfigRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const b = salvarSchema.parse(req.body);
    const provedorId = req.params.provedorId!;
    const provedor = await prisma.provedor.findUnique({ where: { id: provedorId }, select: { id: true } });
    if (!provedor) throw new HttpError(404, "Provedor nao encontrado");

    const dados = { baseUrl: b.baseUrl.replace(/\/+$/, ""), chaveCifrada: encrypt(b.chave), ativo: b.ativo ?? true };
    await prisma.atendaiConfig.upsert({
      where: { provedorId },
      create: { provedorId, ...dados },
      update: dados,
    });
    res.status(204).end();
  }),
);

atendaiConfigRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    await prisma.atendaiConfig.deleteMany({ where: { provedorId: req.params.provedorId! } });
    res.status(204).end();
  }),
);

/**
 * "Testar conexao" — bate numa rota inofensiva e de leitura.
 *
 * `GET /colaboradores` e a escolha certa: existe, e barata, e nao cria nada.
 * Testar com uma rota de escrita deixaria lixo no sistema do provedor toda vez
 * que alguem clicasse no botao.
 */
atendaiConfigRouter.post(
  "/testar",
  asyncHandler(async (req, res) => {
    const cred = await credencialDoProvedor(req.params.provedorId!);
    if (!cred) throw new HttpError(409, "AtendAI nao configurado (ou desativado) para este provedor");
    try {
      const r = await chamar<{ itens: unknown[] }>(cred, "GET", "/colaboradores");
      res.json({ ok: true, colaboradores: Array.isArray(r?.itens) ? r.itens.length : 0 });
    } catch (e) {
      // 200 com ok:false, e nao 5xx: a chamada DAQUI funcionou; quem falhou foi
      // o outro lado, e a tela precisa distinguir "errei o cadastro" de "o
      // ISPhub caiu".
      res.json({ ok: false, erro: e instanceof Error ? e.message : "Falha ao falar com o AtendAI" });
    }
  }),
);

/**
 * Gera a chave que o AtendAI usa pra ENTRAR aqui (agendar).
 *
 * Devolve em claro UMA vez — nao ha segunda chance, porque so o hash e
 * guardado. Regerar invalida a anterior no mesmo instante, e e por isso que
 * este botao serve tambem de revogacao: chave vazada some com um clique, sem
 * depender de alguem lembrar de um segundo botao.
 */
atendaiConfigRouter.post(
  "/chave-entrada",
  asyncHandler(async (req, res) => {
    const provedorId = req.params.provedorId!;
    const existe = await prisma.atendaiConfig.findUnique({ where: { provedorId }, select: { id: true } });
    if (!existe) throw new HttpError(409, "Cadastre o AtendAI deste provedor antes de gerar a chave");
    res.json({ chave: await gerarChaveEntrada(provedorId) });
  }),
);

/** Tira a chave de circulacao sem desfazer o resto do cadastro. */
atendaiConfigRouter.delete(
  "/chave-entrada",
  asyncHandler(async (req, res) => {
    await revogarChaveEntrada(req.params.provedorId!);
    res.status(204).end();
  }),
);
