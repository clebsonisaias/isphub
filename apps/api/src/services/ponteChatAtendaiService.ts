import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ConversaTipo, MensagemTipo, UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { HttpError } from "../middleware/errorHandler.js";
import { chamar, credencialDoProvedor, type CredencialAtendai } from "./atendaiService.js";
import { avisarParticipantes, montarConversaResumo } from "./chatService.js";
import { receberDoCliente, type AvisoCliente } from "./clienteAtendaiService.js";

/**
 * PONTE DO CHAT INTERNO COM O ATENDAI (aprovado em 23/10/2026).
 *
 * O chat interno do AtendAI e o centro: a atendente conversa por la, o tecnico
 * por aqui (web e app), e a mensagem de um aparece no do outro.
 *
 * - Tecnicos e supervisores daqui viram "colaboradores externos" no AtendAI do
 *   provedor (idExterno = id do usuario aqui): assim aparecem na lista de nova
 *   conversa das atendentes.
 * - Mensagem nova no AtendAI que envolve gente daqui chega por webhook assinado
 *   (`receberAviso`) e cai numa conversa espelhada (`Conversa.atendaiConversaId`).
 * - Resposta escrita aqui numa conversa espelhada vai para la (`enviarAoAtendai`).
 *   O AtendAI nao devolve ao ISPhub o que veio dele (sem eco).
 *
 * Primeira versao: so texto. Foto, audio e localizacao viram uma linha de texto
 * dizendo o que foi enviado aqui.
 */

const PAPEIS_NO_ATENDAI = [UserRole.TECNICO, UserRole.GESTOR, UserRole.ADMIN];
const ROTULO_PAPEL: Partial<Record<string, string>> = {
  [UserRole.TECNICO]: "técnico",
  [UserRole.GESTOR]: "supervisor",
  [UserRole.ADMIN]: "supervisor",
};
const SEM_LOGIN = "@sem-login.isphub.invalid";

/** Como a pessoa daqui aparece para as atendentes: "Alderi (técnico)". */
export function nomeNoAtendai(u: { nome: string; role: string }): string {
  return `${u.nome} (${ROTULO_PAPEL[u.role] ?? "ISPhub"})`;
}

/** Confere a assinatura `X-AtendeHub-Signature: sha256=<hex>` do corpo CRU, em tempo constante. */
export function assinaturaConfere(corpo: Buffer, assinatura: string | undefined, segredo: string): boolean {
  if (!assinatura?.startsWith("sha256=")) return false;
  const esperada = Buffer.from(`sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`);
  const recebida = Buffer.from(assinatura);
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

const avisoSchema = z.object({
  evento: z.string(),
  conversaId: z.string().min(1),
  conversa: z.object({ tipo: z.string().nullable(), titulo: z.string().nullable() }).nullish(),
  participantes: z
    .array(z.object({ colaboradorId: z.string(), nome: z.string(), idExterno: z.string().nullable() }))
    .default([]),
  mensagem: z.object({
    id: z.string().min(1),
    corpo: z.string().nullable(),
    autor: z.object({ id: z.string(), nome: z.string() }).nullable(),
  }),
});
export type AvisoChat = z.infer<typeof avisoSchema>;

/**
 * Tipo e titulo da conversa espelhada. Direta: o nome de quem esta do lado do
 * AtendAI. Grupo: o titulo de la, ou os nomes de quem e de la.
 */
export function espelhoDe(aviso: AvisoChat): { tipo: ConversaTipo; titulo: string } {
  const deLa = aviso.participantes.filter((p) => !p.idExterno).map((p) => p.nome);
  if (aviso.conversa?.tipo === "GRUPO") {
    return { tipo: ConversaTipo.GRUPO, titulo: aviso.conversa.titulo ?? `${deLa.join(", ") || "Equipe"} (AtendAI)` };
  }
  return { tipo: ConversaTipo.DIRETA, titulo: `${deLa[0] ?? aviso.mensagem.autor?.nome ?? "Atendimento"} (AtendAI)` };
}

/** O que vai para o AtendAI quando a mensagem daqui nao e texto (a primeira versao so leva texto). */
export function textoParaAtendai(m: {
  tipo: string;
  corpo?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string | null {
  switch (m.tipo) {
    case MensagemTipo.TEXTO:
      return m.corpo?.trim() || null;
    case MensagemTipo.FOTO:
      return m.corpo?.trim() ? `[Foto enviada no ISPhub] ${m.corpo.trim()}` : "[Foto enviada no ISPhub]";
    case MensagemTipo.AUDIO:
      return "[Áudio enviado no ISPhub]";
    case MensagemTipo.LOCALIZACAO:
      return m.lat != null && m.lng != null ? `Localização: https://maps.google.com/?q=${m.lat},${m.lng}` : "[Localização enviada no ISPhub]";
    case MensagemTipo.OS_REF:
      return "[OS citada no ISPhub]";
    default:
      return null;
  }
}

// Quem ja foi cadastrado no AtendAI nesta execucao: evita uma chamada a mais por mensagem.
// ponytail: cache em memoria, se perde no restart (o cadastro la e idempotente).
const jaCadastrado = new Set<string>();

export async function cadastrarNoAtendai(cred: CredencialAtendai, provedorId: string, u: { id: string; nome: string; role: string }) {
  const chave = `${provedorId}:${u.id}`;
  if (jaCadastrado.has(chave)) return;
  await chamar(cred, "POST", "/colaboradores", { idExterno: u.id, nome: nomeNoAtendai(u) });
  jaCadastrado.add(chave);
}

async function credencialOuErro(provedorId: string): Promise<CredencialAtendai> {
  const cred = await credencialDoProvedor(provedorId);
  if (!cred) throw new HttpError(409, "Cadastre as credenciais do AtendAI deste provedor antes de ligar o chat");
  return cred;
}

/** Cadastra no AtendAI do provedor os tecnicos e supervisores ativos (com acesso). Devolve quantos. */
export async function sincronizarColaboradores(provedorId: string): Promise<number> {
  const cred = await credencialOuErro(provedorId);
  const usuarios = await prisma.usuario.findMany({
    where: { ativo: true, role: { in: PAPEIS_NO_ATENDAI }, NOT: { email: { endsWith: SEM_LOGIN } } },
    select: { id: true, nome: true, role: true },
  });
  for (const u of usuarios) await cadastrarNoAtendai(cred, provedorId, u);
  return usuarios.length;
}

/** Os provedores com o chat ligado — o job diario cadastra os tecnicos novos. */
export async function sincronizarColaboradoresDeTodos(): Promise<void> {
  const ligados = await prisma.atendaiConfig.findMany({
    where: { ativo: true, chatLigadoEm: { not: null } },
    select: { provedorId: true },
  });
  for (const { provedorId } of ligados) {
    try {
      const n = await sincronizarColaboradores(provedorId);
      console.log(`[chat-atendai] provedor ${provedorId}: ${n} pessoa(s) no chat do AtendAI`);
    } catch (e) {
      console.error(`[chat-atendai] provedor ${provedorId}:`, e instanceof Error ? e.message : e);
    }
  }
}

/**
 * "Ligar chat": registra no AtendAI o webhook que avisa mensagem nova (trocando
 * o anterior, se houver) e cadastra a equipe daqui como colaboradores de la.
 */
export async function ligarChat(provedorId: string, urlPublica: string) {
  const cred = await credencialOuErro(provedorId);
  const cfg = await prisma.atendaiConfig.findUniqueOrThrow({ where: { provedorId }, select: { chatWebhookId: true } });
  if (cfg.chatWebhookId) {
    await chamar(cred, "DELETE", `/webhooks/${cfg.chatWebhookId}`).catch(() => undefined);
  }
  const url = `${urlPublica.replace(/\/+$/, "")}/api/atendai/chat/${provedorId}`;
  const r = await chamar<{ id: string; segredo: string }>(cred, "POST", "/webhooks", {
    url,
    eventos: ["chat_nova_mensagem", "cliente_nova_mensagem"],
  });
  await prisma.atendaiConfig.update({
    where: { provedorId },
    data: { segredoCifrado: encrypt(r.segredo), chatWebhookId: r.id, chatLigadoEm: new Date() },
  });
  const colaboradores = await sincronizarColaboradores(provedorId);
  return { ok: true, url, colaboradores };
}

export type ResultadoAviso = "ok" | "assinatura" | "ignorado";

/**
 * Mensagem nova no chat do AtendAI envolvendo gente daqui: espelha a conversa
 * (cria na primeira vez), grava a mensagem uma vez so e avisa os participantes.
 */
export async function receberAviso(provedorId: string, corpo: Buffer, assinatura: string | undefined): Promise<ResultadoAviso> {
  const cfg = await prisma.atendaiConfig.findUnique({ where: { provedorId }, select: { segredoCifrado: true, ativo: true } });
  if (!cfg?.ativo || !cfg.segredoCifrado) return "assinatura";
  if (!assinaturaConfere(corpo, assinatura, decrypt(cfg.segredoCifrado))) return "assinatura";

  let json: unknown;
  try {
    json = JSON.parse(corpo.toString("utf8"));
  } catch {
    return "ignorado";
  }
  // Resposta do cliente numa conversa aberta pela OS (mesmo webhook, outro evento).
  if ((json as { evento?: unknown })?.evento === "cliente_nova_mensagem") {
    return receberDoCliente(provedorId, json as AvisoCliente);
  }
  const lido = avisoSchema.safeParse(json);
  if (!lido.success) return "ignorado";
  const aviso = lido.data;
  const texto = aviso.mensagem.corpo?.trim();
  if (aviso.evento !== "chat_nova_mensagem" || !texto) return "ignorado";
  if (await prisma.mensagem.findUnique({ where: { atendaiMensagemId: aviso.mensagem.id }, select: { id: true } })) {
    return "ignorado";
  }

  const ids = aviso.participantes.flatMap((p) => (p.idExterno ? [p.idExterno] : []));
  const daqui = await prisma.usuario.findMany({ where: { id: { in: ids }, ativo: true }, select: { id: true } });
  if (daqui.length === 0) return "ignorado";

  const { tipo, titulo } = espelhoDe(aviso);
  const conversa = await prisma.conversa.upsert({
    where: { atendaiConversaId: aviso.conversaId },
    create: {
      tipo,
      titulo,
      provedorId,
      atendaiConversaId: aviso.conversaId,
      participantes: { create: daqui.map((u) => ({ usuarioId: u.id })) },
    },
    update: { titulo },
    select: { id: true },
  });
  // Gente daqui que entrou depois na conversa de la passa a ver o espelho tambem.
  await prisma.conversaParticipante.createMany({
    data: daqui.map((u) => ({ conversaId: conversa.id, usuarioId: u.id })),
    skipDuplicates: true,
  });

  const autorNome = aviso.mensagem.autor?.nome ?? "AtendAI";
  const mensagem = await prisma.mensagem.create({
    data: {
      conversaId: conversa.id,
      tipo: MensagemTipo.TEXTO,
      corpo: texto,
      autorExternoNome: autorNome,
      atendaiMensagemId: aviso.mensagem.id,
    },
    select: { id: true },
  });
  const participantes = await prisma.conversaParticipante.findMany({
    where: { conversaId: conversa.id, saiuEm: null },
    select: { usuarioId: true, silenciado: true },
  });
  await prisma.$transaction([
    prisma.conversa.update({ where: { id: conversa.id }, data: { ultimaMensagemEm: new Date() } }),
    prisma.notificacao.createMany({
      data: participantes
        .filter((p) => !p.silenciado)
        .map((p) => ({ usuarioId: p.usuarioId, tipo: "mensagem", mensagem: `${autorNome} (AtendAI): ${texto.slice(0, 80)}` })),
    }),
  ]);
  avisarParticipantes(participantes, {
    conversaId: conversa.id,
    mensagemId: mensagem.id,
    autorId: null,
    titulo: `${autorNome} (AtendAI)`,
    corpo: texto.slice(0, 140),
  });
  return "ok";
}

/** Resposta escrita aqui numa conversa espelhada: vai para a conversa de la, em nome de quem escreveu. */
export async function enviarAoAtendai(
  provedorId: string,
  atendaiConversaId: string,
  autor: { id: string; nome: string; role: string },
  m: { tipo: string; corpo?: string | null; lat?: number | null; lng?: number | null },
): Promise<void> {
  const corpo = textoParaAtendai(m);
  if (!corpo) return;
  try {
    const cred = await credencialDoProvedor(provedorId);
    if (!cred) return;
    await cadastrarNoAtendai(cred, provedorId, autor);
    await chamar(cred, "POST", `/conversas/${encodeURIComponent(atendaiConversaId)}/mensagens`, { deIdExterno: autor.id, corpo });
  } catch (e) {
    console.warn(`[chat-atendai] nao entregou a mensagem ao AtendAI (conversa ${atendaiConversaId}):`, e instanceof Error ? e.message : e);
  }
}

export interface ContatoAtendai {
  provedorId: string;
  provedorNome: string;
  colaboradorId: string;
  nome: string;
}

/** A equipe do AtendAI (atendentes) de cada provedor com o chat ligado — para o tecnico abrir conversa. */
export async function contatosAtendai(): Promise<ContatoAtendai[]> {
  const ligados = await prisma.atendaiConfig.findMany({
    where: { ativo: true, chatLigadoEm: { not: null } },
    select: { provedorId: true, provedor: { select: { nome: true } } },
  });
  const saida: ContatoAtendai[] = [];
  for (const l of ligados) {
    const cred = await credencialDoProvedor(l.provedorId);
    if (!cred) continue;
    try {
      const r = await chamar<{ itens: { id: string; nome: string; interno?: boolean }[] }>(cred, "GET", "/colaboradores?escopo=empresa");
      for (const c of r.itens ?? []) {
        if (c.interno) saida.push({ provedorId: l.provedorId, provedorNome: l.provedor.nome, colaboradorId: c.id, nome: c.nome });
      }
    } catch (e) {
      console.warn(`[chat-atendai] contatos do provedor ${l.provedorId}:`, e instanceof Error ? e.message : e);
    }
  }
  return saida;
}

/** Abre (ou reabre) a conversa direta com uma atendente do AtendAI e devolve o espelho daqui. */
export async function conversaComAtendente(
  usuario: { id: string; nome: string; role: string },
  provedorId: string,
  colaboradorId: string,
  nome: string,
) {
  const cred = await credencialOuErro(provedorId);
  await cadastrarNoAtendai(cred, provedorId, usuario);
  const r = await chamar<{ id: string }>(cred, "POST", "/conversas", {
    deIdExterno: usuario.id,
    tipo: "DIRETA",
    participantesColaboradorIds: [colaboradorId],
  });
  const conversa = await prisma.conversa.upsert({
    where: { atendaiConversaId: r.id },
    create: {
      tipo: ConversaTipo.DIRETA,
      titulo: `${nome} (AtendAI)`,
      provedorId,
      atendaiConversaId: r.id,
      criadoPorId: usuario.id,
      participantes: { create: [{ usuarioId: usuario.id }] },
    },
    update: {},
    select: { id: true },
  });
  await prisma.conversaParticipante.createMany({ data: [{ conversaId: conversa.id, usuarioId: usuario.id }], skipDuplicates: true });
  return montarConversaResumo(conversa.id, usuario.id);
}
