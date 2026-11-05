import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { decrypt, encrypt, maskToken } from "../lib/crypto.js";
import { validarUrlExterna } from "../lib/urlValidation.js";
import { chamar, credencialDoProvedor } from "../services/atendaiService.js";
import { chaveDoProvedor, gerarChaveEntrada, revogarChaveEntrada } from "../services/chaveParceiroService.js";
import { ligarChat } from "../services/ponteChatAtendaiService.js";
import { canaisDoProvedor, definirCanalClientes } from "../services/clienteAtendaiService.js";

/**
 * Cadastro da ligacao de um provedor com o AtendAI.
 *
 * Espelha `erpConfig.ts` de proposito: e o mesmo problema (credencial de
 * sistema externo, por provedor, que nunca pode voltar em GET), e resolver de
 * outro jeito daria dois padroes de segredo pra manter.
 */
export const atendaiConfigRouter = Router({ mergeParams: true });

atendaiConfigRouter.use(requireAuth, requireRole(UserRole.ADMIN));

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
    // A chave de parceiro e do PROVEDOR (tabela propria, desde 07/10/2026);
    // aqui so aparece pra tela do AtendAI saber se a ligacao esta feita.
    const chave = await chaveDoProvedor(row.provedorId);

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
      chaveEntradaPrefixo: chave?.prefixo ?? null,
      chaveEntradaUsoEm: chave?.usoEm ?? null,
      chatLigadoEm: row.chatLigadoEm,
      canalClientes: row.canalClientesId ? { id: row.canalClientesId, nome: row.canalClientesNome ?? row.canalClientesId } : null,
      ofertaAgendaAtiva: row.ofertaAgendaAtiva,
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
    // Atalho mantido pra tela do AtendAI; a rota canonica e
    // `POST /provedores/:id/chave-parceiro`, que serve a qualquer sistema.
    res.json({ chave: await gerarChaveEntrada(req.params.provedorId!, "AtendAI") });
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

/**
 * "Ligar agendamento" — gera a chave e a ENTREGA ao AtendAI, numa tacada.
 *
 * Tira o copia-e-cola do meio. Antes, ligar as duas plataformas era gerar a
 * chave aqui, copiar, e colar la — e uma chave que passa pela area de
 * transferencia de alguem e uma chave que pode acabar num chat, num bloco de
 * notas, ou colada no provedor errado. Aqui ela nasce e viaja sem ninguem ver.
 *
 * A ORDEM importa: entrega primeiro, e so grava se o outro lado aceitou. Gerar
 * antes deixaria a chave nova valendo aqui e a antiga la — ou seja, a
 * integracao PARARIA de funcionar por causa do botao que existe pra liga-la.
 */
atendaiConfigRouter.post(
  "/ligar-agendamento",
  asyncHandler(async (req, res) => {
    const provedorId = req.params.provedorId!;
    const cred = await credencialDoProvedor(provedorId);
    if (!cred) throw new HttpError(409, "Cadastre as credenciais do AtendAI deste provedor antes de ligar a agenda");

    /*
     * A URL publica desta API, vista de fora. Vem do request e nao de
     * configuracao: atras do proxy, `X-Forwarded-*` diz o endereco pelo qual o
     * mundo REALMENTE alcanca a API — e uma env var a mais e mais uma coisa que
     * pode ficar desatualizada em silencio e so falhar meses depois.
     */
    const doCorpo = z.object({ url: z.string().url().optional() }).parse(req.body ?? {});
    const url = (doCorpo.url ?? `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

    const chave = await gerarChaveEntrada(provedorId, "AtendAI");
    try {
      await chamar(cred, "POST", "/isphub/vincular", { url, chave });
    } catch (e) {
      // O outro lado recusou: a chave que acabamos de gerar nao serve pra
      // ninguem, e deixa-la valida so aumentaria a superficie por nada.
      await revogarChaveEntrada(provedorId);
      throw new HttpError(
        502,
        `O AtendAI nao aceitou a ligacao: ${e instanceof Error ? e.message : "falha desconhecida"}`,
      );
    }

    res.json({ ok: true, url });
  }),
);

/**
 * "Ligar chat" — o chat interno daqui passa a falar com o do AtendAI: registra
 * la o webhook de mensagem nova (com a URL publica desta API, como no "Ligar
 * agendamento") e cadastra tecnicos e supervisores como colaboradores de la.
 */
atendaiConfigRouter.post(
  "/ligar-chat",
  asyncHandler(async (req, res) => {
    const doCorpo = z.object({ url: z.string().url().optional() }).parse(req.body ?? {});
    const url = (doCorpo.url ?? `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    try {
      res.json(await ligarChat(req.params.provedorId!, url));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, `O AtendAI nao aceitou ligar o chat: ${e instanceof Error ? e.message : "falha desconhecida"}`);
    }
  }),
);


/** Canais de WhatsApp do AtendAI do provedor — para escolher por onde a equipe fala com os clientes. */
atendaiConfigRouter.get(
  "/canais",
  asyncHandler(async (req, res) => {
    res.json(await canaisDoProvedor(req.params.provedorId!));
  }),
);

/** "As conversas com os clientes deste provedor saem pelo canal X" (`null` tira). */
atendaiConfigRouter.put(
  "/canal-clientes",
  asyncHandler(async (req, res) => {
    const { canalId } = z.object({ canalId: z.string().min(1).nullable() }).parse(req.body ?? {});
    res.json({ canalClientes: await definirCanalClientes(req.params.provedorId!, canalId) });
  }),
);

/** Liga/desliga o robo de agendamento do provedor (oferta de datas por WhatsApp). */
atendaiConfigRouter.put(
  "/oferta-agenda",
  asyncHandler(async (req, res) => {
    const { ativa } = z.object({ ativa: z.boolean() }).parse(req.body ?? {});
    const row = await prisma.atendaiConfig.findUnique({ where: { provedorId: req.params.provedorId! }, select: { id: true } });
    if (!row) throw new HttpError(404, "Cadastre o AtendAI deste provedor antes de ligar o robô de agendamento.");
    await prisma.atendaiConfig.update({ where: { id: row.id }, data: { ofertaAgendaAtiva: ativa } });
    res.json({ ofertaAgendaAtiva: ativa });
  }),
);
