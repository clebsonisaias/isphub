import {
  ConversaTipo,
  MensagemTipo,
  OsStatus,
  ROLES_INTERNOS,
  UserRole,
  type ConversaResumo,
  type ContatoChat,
  type Mensagem as MensagemDTO,
  type MensagemResumo,
  type ParticipanteResumo,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { emitParaUsuario } from "./realtimeHub.js";
import { podeAcessarOs } from "./escopoService.js";
import * as writebackService from "./writebackService.js";
import type { JwtPayload } from "./authService.js";

/**
 * Chat interno de operacao — NAO e messenger social, e coordenacao de campo
 * ancorada no trabalho (thread por OS e a conversa mais importante). Copia o
 * padrao ja estabelecido em writebackService.atribuirTecnico: transacao pra
 * escrita + notificacao, e SO DEPOIS emitParaUsuario (o SSE e best-effort,
 * nunca faz parte da consistencia da escrita).
 *
 * PROVEDOR nunca participa — a guarda de verdade e `podeParticipar`, chamada
 * em TODA rota de leitura/escrita (nunca confie no cliente).
 */

/** ~2min sem atividade = offline. Mesma janela usada pelo middleware de presenca. */
const JANELA_ONLINE_MS = 2 * 60_000;

export function estaOnline(ultimaAtividadeEm: Date | null): boolean {
  if (!ultimaAtividadeEm) return false;
  return Date.now() - ultimaAtividadeEm.getTime() < JANELA_ONLINE_MS;
}

/**
 * A marca d'agua de nao-lidas: sem uma linha "lido" por mensagem, conta
 * quantas mensagens (nao apagadas) chegaram DEPOIS da ultima leitura
 * registrada. `ultimaLeituraEm: null` (nunca leu) conta TODAS as mensagens
 * nao apagadas da conversa — por isso o espalhamento condicional em vez de
 * `criadoEm: { gt: null }` (que o Prisma trataria como "sem filtro", nao como
 * "tudo", numa leitura ingenua).
 */
export function whereMensagensNaoLidas(conversaId: string, ultimaLeituraEm: Date | null) {
  return {
    conversaId,
    apagadoEm: null,
    ...(ultimaLeituraEm ? { criadoEm: { gt: ultimaLeituraEm } } : {}),
  };
}

function participanteResumo(u: { id: string; nome: string; role: string; ultimaAtividadeEm: Date | null }): ParticipanteResumo {
  return {
    usuarioId: u.id,
    nome: u.nome,
    role: u.role as UserRole,
    online: estaOnline(u.ultimaAtividadeEm),
    ultimaAtividadeEm: u.ultimaAtividadeEm?.toISOString() ?? null,
  };
}

/** Preview curto pra resposta citada / ultima mensagem — bolha ainda nao apagada. */
export function resumoConteudo(m: { tipo: string; corpo: string | null; apagadoEm: Date | null }): string {
  if (m.apagadoEm) return "Mensagem apagada";
  if (m.corpo) return m.corpo.length > 80 ? `${m.corpo.slice(0, 80)}…` : m.corpo;
  switch (m.tipo) {
    case MensagemTipo.FOTO:
      return "📷 Foto";
    case MensagemTipo.AUDIO:
      return "🎤 Áudio";
    case MensagemTipo.LOCALIZACAO:
      return "📍 Localização";
    case MensagemTipo.OS_REF:
      return "📋 Ordem de serviço";
    default:
      return "";
  }
}

// ---- Guarda de participacao (chamada em TODA rota) ----

/**
 * PROVEDOR nunca participa do chat — nem precisa consultar o banco. Pra
 * qualquer outro papel, so participa quem tem um ConversaParticipante ativo
 * (saiuEm null) pra essa conversa.
 */
export async function podeParticipar(user: JwtPayload, conversaId: string): Promise<boolean> {
  if (user.role === UserRole.PROVEDOR) return false;
  const p = await prisma.conversaParticipante.findFirst({
    where: { conversaId, usuarioId: user.sub, saiuEm: null },
    select: { id: true },
  });
  return !!p;
}

/** Lanca 403 se o usuario nao participa — usar no inicio de toda rota que le/escreve numa conversa. */
export async function exigirParticipacao(user: JwtPayload, conversaId: string): Promise<void> {
  if (!(await podeParticipar(user, conversaId))) {
    throw new HttpError(403, "Voce nao participa desta conversa");
  }
}

// ---- Contatos ----

/** Projecao MINIMA pra "Nova conversa" — nunca email/provedorId/hash. So equipe interna ativa. */
export async function listarContatos(excetoUsuarioId: string): Promise<ContatoChat[]> {
  const usuarios = await prisma.usuario.findMany({
    where: {
      ativo: true,
      role: { in: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] },
      id: { not: excetoUsuarioId },
    },
    select: { id: true, nome: true, role: true, ultimaAtividadeEm: true },
    orderBy: { nome: "asc" },
  });
  return usuarios.map((u) => ({ id: u.id, nome: u.nome, role: u.role as UserRole, online: estaOnline(u.ultimaAtividadeEm) }));
}

// ---- Conversas ----

async function montarConversaResumo(conversaId: string, usuarioId: string): Promise<ConversaResumo> {
  const conversa = await prisma.conversa.findUniqueOrThrow({
    where: { id: conversaId },
    include: {
      ordemServico: { select: { sgpOsId: true } },
      participantes: {
        where: { saiuEm: null },
        include: { usuario: { select: { id: true, nome: true, role: true, ultimaAtividadeEm: true } } },
      },
    },
  });
  const meuParticipante = conversa.participantes.find((p) => p.usuarioId === usuarioId);
  const ultima = await prisma.mensagem.findFirst({
    where: { conversaId },
    orderBy: { criadoEm: "desc" },
    include: { autor: { select: { nome: true } } },
  });

  const outros = conversa.participantes.filter((p) => p.usuarioId !== usuarioId);
  const titulo =
    conversa.titulo ??
    (conversa.tipo === ConversaTipo.DIRETA
      ? (outros[0]?.usuario.nome ?? "Conversa")
      : conversa.tipo === ConversaTipo.OS
        ? `OS #${conversa.ordemServico?.sgpOsId ?? "?"}`
        : "Conversa");

  const naoLidas = await prisma.mensagem.count({
    where: whereMensagensNaoLidas(conversaId, meuParticipante?.ultimaLeituraEm ?? null),
  });

  const ultimaMensagem: MensagemResumo | null = ultima
    ? {
        id: ultima.id,
        tipo: ultima.tipo as MensagemTipo,
        corpo: ultima.apagadoEm ? null : ultima.corpo,
        autorNome: ultima.autor?.nome ?? null,
        apagadoEm: ultima.apagadoEm?.toISOString() ?? null,
        criadoEm: ultima.criadoEm.toISOString(),
      }
    : null;

  return {
    id: conversa.id,
    tipo: conversa.tipo as ConversaTipo,
    titulo,
    avatarCor: null,
    ordemServicoId: conversa.ordemServicoId,
    sgpOsId: conversa.ordemServico?.sgpOsId ?? null,
    participantes: conversa.participantes.map((p) => participanteResumo(p.usuario)),
    ultimaMensagem,
    naoLidas,
    silenciado: meuParticipante?.silenciado ?? false,
    atualizadoEm: (conversa.ultimaMensagemEm ?? conversa.criadoEm).toISOString(),
  };
}

/** Lista as conversas do usuario, mais recente primeiro. Uma query pra achar os ids + N montagens leves (poucas conversas por usuario). */
export async function listarConversas(usuarioId: string): Promise<ConversaResumo[]> {
  const participacoes = await prisma.conversaParticipante.findMany({
    where: { usuarioId, saiuEm: null },
    select: { conversaId: true },
    orderBy: { conversa: { ultimaMensagemEm: "desc" } },
  });
  const resumos = await Promise.all(participacoes.map((p) => montarConversaResumo(p.conversaId, usuarioId)));
  return resumos.sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
}

/** DM idempotente: se ja existe uma conversa DIRETA entre exatamente os dois, devolve ela. */
export async function criarOuObterConversaDireta(usuarioAId: string, usuarioBId: string): Promise<ConversaResumo> {
  if (usuarioAId === usuarioBId) throw new HttpError(400, "Nao e possivel abrir uma DM consigo mesmo");
  const existente = await prisma.conversa.findFirst({
    where: {
      tipo: ConversaTipo.DIRETA,
      AND: [
        { participantes: { some: { usuarioId: usuarioAId, saiuEm: null } } },
        { participantes: { some: { usuarioId: usuarioBId, saiuEm: null } } },
      ],
      participantes: { every: { usuarioId: { in: [usuarioAId, usuarioBId] } } },
    },
    select: { id: true },
  });
  if (existente) return montarConversaResumo(existente.id, usuarioAId);

  const criada = await prisma.conversa.create({
    data: {
      tipo: ConversaTipo.DIRETA,
      criadoPorId: usuarioAId,
      participantes: { create: [{ usuarioId: usuarioAId }, { usuarioId: usuarioBId, admin: false }] },
    },
  });
  return montarConversaResumo(criada.id, usuarioAId);
}

/** Grupo — so ADMIN/GESTOR cria (guarda de papel fica na rota, via requireRole). */
export async function criarConversaGrupo(titulo: string, participanteIds: string[], criadoPorId: string): Promise<ConversaResumo> {
  const idsUnicos = Array.from(new Set([...participanteIds, criadoPorId]));
  const criada = await prisma.conversa.create({
    data: {
      tipo: ConversaTipo.GRUPO,
      titulo,
      criadoPorId,
      participantes: { create: idsUnicos.map((usuarioId) => ({ usuarioId, admin: usuarioId === criadoPorId })) },
    },
  });
  return montarConversaResumo(criada.id, criadoPorId);
}

/**
 * Sem @unique pra travar "1 por tipo" no schema (so a OS-thread precisa
 * disso, via ordemServicoId). Duas abas/usuarios abrindo o chat pela
 * primeira vez ao mesmo tempo cairiam os dois no "nao existe ainda" e cada
 * um criaria o SEU canal — travado aqui por um lock em memoria (mesmo
 * espirito single-process do realtimeHub): a 2a chamada concorrente espera
 * a promise da 1a em vez de criar de novo. So protege dentro de UM processo
 * Node — suficiente pro deploy atual (ver nota do realtimeHub).
 */
let avisosPromiseEmCriacao: Promise<{ id: string }> | null = null;

async function criarConversaAvisos(autorId: string): Promise<{ id: string }> {
  const internos = await prisma.usuario.findMany({
    where: { ativo: true, role: { in: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] } },
    select: { id: true },
  });
  return prisma.conversa.create({
    data: {
      tipo: ConversaTipo.AVISOS,
      titulo: "Avisos",
      criadoPorId: autorId,
      participantes: { create: internos.map((u) => ({ usuarioId: u.id, admin: u.id === autorId })) },
    },
    select: { id: true },
  });
}

/** Canal unico "Avisos" — leitura pra todo interno ativo, escrita restrita a ADMIN/GESTOR (checado em enviarMensagem, nao aqui). */
export async function garantirConversaAvisos(autorId: string): Promise<ConversaResumo> {
  const existente = await prisma.conversa.findFirst({ where: { tipo: ConversaTipo.AVISOS }, select: { id: true } });
  if (existente) {
    await prisma.conversaParticipante.upsert({
      where: { conversaId_usuarioId: { conversaId: existente.id, usuarioId: autorId } },
      update: { saiuEm: null },
      create: { conversaId: existente.id, usuarioId: autorId },
    });
    return montarConversaResumo(existente.id, autorId);
  }

  if (!avisosPromiseEmCriacao) {
    avisosPromiseEmCriacao = criarConversaAvisos(autorId).finally(() => {
      avisosPromiseEmCriacao = null;
    });
  }
  const conversa = await avisosPromiseEmCriacao;
  // Se outro request venceu a corrida, garante que EU tambem viro participante.
  await prisma.conversaParticipante.upsert({
    where: { conversaId_usuarioId: { conversaId: conversa.id, usuarioId: autorId } },
    update: { saiuEm: null },
    create: { conversaId: conversa.id, usuarioId: autorId },
  });
  return montarConversaResumo(conversa.id, autorId);
}

/**
 * Thread da OS — idempotente gracas ao @unique em Conversa.ordemServicoId
 * (upsert evita corrida entre dois cliques quase simultaneos). Participantes:
 * o tecnico atribuido (se houver) + todo admin/gestor ATIVO — o time inteiro
 * de despacho ve a conversa, nao so quem a abriu primeiro.
 */
export async function garantirConversaDeOs(user: JwtPayload, ordemServicoId: string): Promise<ConversaResumo> {
  const autorId = user.sub;
  const os = await prisma.ordemServico.findUnique({
    where: { id: ordemServicoId },
    select: { id: true, tecnicoId: true, provedorId: true },
  });
  if (!os) throw new HttpError(404, "Ordem de servico nao encontrada");

  // MESMA autorizacao da rota REST da OS. Sem isto havia dois caminhos pro
  // mesmo estado com regras diferentes: /ordens-servico/:id/* exigia
  // podeAcessarOs, e esta rota nao exigia nada — bastava conhecer o uuid da OS
  // (ex.: uma OS que foi REATRIBUIDA pra outro tecnico) pra virar participante
  // da thread e, de dentro dela, disparar resposta-rapida, que escreve status
  // no SGP do provedor. A porta dos fundos tinha mais poder que a da frente.
  if (!podeAcessarOs(user, os)) {
    throw new HttpError(403, "Acesso restrito ao proprio provedor/tecnico");
  }

  const internos = await prisma.usuario.findMany({
    where: { ativo: true, role: { in: ROLES_INTERNOS } },
    select: { id: true },
  });
  const participanteIds = new Set<string>([...internos.map((u) => u.id), autorId]);
  if (os.tecnicoId) participanteIds.add(os.tecnicoId);

  const conversa = await prisma.conversa.upsert({
    where: { ordemServicoId },
    update: {},
    create: {
      tipo: ConversaTipo.OS,
      ordemServicoId,
      criadoPorId: autorId,
      participantes: { create: Array.from(participanteIds).map((usuarioId) => ({ usuarioId })) },
    },
  });

  // Numa thread que JA existia o `update: {}` nao inscreve ninguem — quem tem
  // acesso a OS mas nao estava na lista (ex.: o tecnico que acabou de receber
  // a OS) ficava de fora da propria conversa. Reconcilia aqui: passou no
  // podeAcessarOs acima, entao entra (ou volta, se tinha saido).
  await prisma.conversaParticipante.upsert({
    where: { conversaId_usuarioId: { conversaId: conversa.id, usuarioId: autorId } },
    update: { saiuEm: null },
    create: { conversaId: conversa.id, usuarioId: autorId },
  });

  return montarConversaResumo(conversa.id, autorId);
}

// ---- Mensagens ----

/** Limites validados no servidor — nunca confiar so no cliente. */
export const LIMITE_FOTO_BYTES = 400 * 1024;
export const LIMITE_AUDIO_BYTES = 500 * 1024;
export const LIMITE_AUDIO_SEG = 60;
/** Teto de reacoes carregadas por mensagem (ver listarMensagens). */
export const LIMITE_REACOES_POR_MENSAGEM = 50;
const MIMES_FOTO = ["image/jpeg", "image/png", "image/webp"];
const MIMES_AUDIO = ["audio/webm", "audio/mp4", "audio/m4a", "audio/ogg"];

export interface EnviarMensagemInput {
  tipo: MensagemTipo;
  corpo?: string | null;
  anexoBase64?: string | null;
  anexoMime?: string | null;
  duracaoSeg?: number | null;
  lat?: number | null;
  lng?: number | null;
  ordemServicoRefId?: string | null;
  respondendoAId?: string | null;
}

export function validarMidia(input: EnviarMensagemInput): { dados: Buffer | null; tamanho: number | null } {
  if (input.tipo === MensagemTipo.FOTO) {
    if (!input.anexoBase64 || !input.anexoMime) throw new HttpError(400, "Foto sem dados/mime");
    if (!MIMES_FOTO.includes(input.anexoMime)) throw new HttpError(400, "Formato de foto nao suportado");
    const dados = Buffer.from(input.anexoBase64, "base64");
    if (dados.byteLength === 0) throw new HttpError(400, "Foto vazia");
    if (dados.byteLength > LIMITE_FOTO_BYTES) throw new HttpError(400, `Foto maior que ${LIMITE_FOTO_BYTES / 1024}KB`);
    return { dados, tamanho: dados.byteLength };
  }
  if (input.tipo === MensagemTipo.AUDIO) {
    if (!input.anexoBase64 || !input.anexoMime) throw new HttpError(400, "Audio sem dados/mime");
    if (!MIMES_AUDIO.includes(input.anexoMime)) throw new HttpError(400, "Formato de audio nao suportado");
    if (input.duracaoSeg != null && input.duracaoSeg > LIMITE_AUDIO_SEG) {
      throw new HttpError(400, `Audio maior que ${LIMITE_AUDIO_SEG}s`);
    }
    const dados = Buffer.from(input.anexoBase64, "base64");
    if (dados.byteLength === 0) throw new HttpError(400, "Audio vazio");
    if (dados.byteLength > LIMITE_AUDIO_BYTES) throw new HttpError(400, `Audio maior que ${LIMITE_AUDIO_BYTES / 1024}KB`);
    return { dados, tamanho: dados.byteLength };
  }
  return { dados: null, tamanho: null };
}

/** Extrai "@nome" do corpo e resolve pra participantes cujo nome (ou primeiro nome) bate, case-insensitive. */
export function resolverMencoes(corpo: string, participantes: { usuarioId: string; nome: string }[]): string[] {
  const arrobas = Array.from(corpo.matchAll(/@([\p{L}0-9._-]+)/gu)).map((m) => m[1].toLowerCase());
  if (arrobas.length === 0) return [];
  const encontrados = new Set<string>();
  for (const p of participantes) {
    const partesNome = p.nome.toLowerCase().split(/\s+/);
    if (arrobas.some((a) => partesNome.some((parte) => parte === a || parte.startsWith(a)))) {
      encontrados.add(p.usuarioId);
    }
  }
  return Array.from(encontrados);
}

/**
 * Envia uma mensagem — copia o padrao de writebackService.atribuirTecnico:
 * transacao (mensagem + Conversa.ultimaMensagemEm + Notificacao pros
 * participantes nao-silenciados OFFLINE), e SO DEPOIS o fan-out SSE via
 * emitParaUsuario. NAO cria OsEvento aqui — mensagem comum nao e marco da OS
 * (ver aplicarRespostaRapidaOs, que e o unico caminho que gera OsEvento,
 * delegando pro writebackService existente em vez de duplicar a logica).
 */
export async function enviarMensagem(conversaId: string, autorId: string, input: EnviarMensagemInput): Promise<MensagemDTO> {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    include: { participantes: { where: { saiuEm: null }, include: { usuario: { select: { id: true, nome: true, role: true } } } } },
  });
  if (!conversa) throw new HttpError(404, "Conversa nao encontrada");

  // Avisos e o canal da empresa inteira: so ADMIN/GESTOR posta.
  //
  // A versao anterior isentava `tipo === SISTEMA` desta checagem, e o schema da
  // rota aceitava `sistema` vindo do cliente — entao qualquer tecnico mandava
  // {"tipo":"sistema"} e publicava um aviso NAO-ATRIBUIDO (os dois clientes
  // renderizam SISTEMA como pilula centralizada, sem autor nem avatar) pra
  // empresa toda, com notificacao e push. Vetor perfeito de phishing interno.
  //
  // Agora: sem isencao aqui, e `sistema` recusado no schema da rota. Mensagem
  // de sistema so nasce no servidor (aplicarRespostaRapidaOs), sempre numa
  // thread de OS — que nunca e do tipo AVISOS, entao nada legitimo quebra.
  if (conversa.tipo === ConversaTipo.AVISOS) {
    const autorRole = conversa.participantes.find((p) => p.usuarioId === autorId)?.usuario.role;
    if (autorRole !== UserRole.ADMIN && autorRole !== UserRole.GESTOR) {
      throw new HttpError(403, "So admin/gestor pode postar no canal de Avisos");
    }
  }

  const { dados, tamanho } = validarMidia(input);

  const [mensagemCriada] = await prisma.$transaction([
    prisma.mensagem.create({
      data: {
        conversaId,
        autorId,
        tipo: input.tipo,
        corpo: input.corpo ?? null,
        anexoDados: dados ? new Uint8Array(dados) : undefined,
        anexoMime: input.anexoMime ?? null,
        anexoTamanho: tamanho,
        duracaoSeg: input.duracaoSeg ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        ordemServicoId: input.ordemServicoRefId ?? null,
        respondendoAId: input.respondendoAId ?? null,
      },
      include: { autor: { select: { id: true, nome: true, role: true, ultimaAtividadeEm: true } } },
    }),
    prisma.conversa.update({ where: { id: conversaId }, data: { ultimaMensagemEm: new Date() } }),
    prisma.notificacao.createMany({
      data: conversa.participantes
        .filter((p) => p.usuarioId !== autorId && !p.silenciado)
        .map((p) => ({
          usuarioId: p.usuarioId,
          tipo: "mensagem",
          mensagem: input.corpo ? `Nova mensagem: ${input.corpo.slice(0, 80)}` : "Nova mensagem no chat",
        })),
    }),
  ]);

  // Fan-out SSE — best-effort, DEPOIS da transacao (se cair, o polling do
  // cliente cobre; nunca faz a escrita depender do SSE).
  const em = new Date().toISOString();
  for (const p of conversa.participantes) {
    if (p.usuarioId === autorId) continue;
    emitParaUsuario(p.usuarioId, { tipo: "chat-mensagem", conversaId, mensagemId: mensagemCriada.id, autorId, em });
  }

  // Mencoes reusam o sistema de Notificacao existente (tipo "mencao") em vez
  // de um segundo canal de alerta — so quando ha corpo de texto pra escanear.
  if (input.corpo) {
    const mencionados = resolverMencoes(
      input.corpo,
      conversa.participantes.map((p) => ({ usuarioId: p.usuario.id, nome: p.usuario.nome })),
    ).filter((id) => id !== autorId);
    if (mencionados.length > 0) {
      await prisma.notificacao.createMany({
        data: mencionados.map((usuarioId) => ({
          usuarioId,
          tipo: "mencao",
          mensagem: `Você foi mencionado: ${input.corpo!.slice(0, 80)}`,
        })),
      });
      for (const usuarioId of mencionados) {
        emitParaUsuario(usuarioId, { tipo: "chat-mensagem", conversaId, mensagemId: mensagemCriada.id, autorId, em });
      }
    }
  }

  return paraMensagemDTO(mensagemCriada);
}

interface MensagemComAutor {
  id: string;
  conversaId: string;
  autorId: string | null;
  autor: { id: string; nome: string; role: string; ultimaAtividadeEm: Date | null } | null;
  tipo: string;
  corpo: string | null;
  anexoMime: string | null;
  anexoTamanho: number | null;
  duracaoSeg: number | null;
  lat: number | null;
  lng: number | null;
  ordemServicoId: string | null;
  respondendoAId: string | null;
  editadoEm: Date | null;
  apagadoEm: Date | null;
  criadoEm: Date;
}

function paraMensagemDTO(m: MensagemComAutor, respondendoA?: { id: string; autorNome: string | null; resumo: string } | null): MensagemDTO {
  const apagada = !!m.apagadoEm;
  return {
    id: m.id,
    conversaId: m.conversaId,
    autor: m.autor ? participanteResumo(m.autor) : null,
    tipo: m.tipo as MensagemTipo,
    corpo: apagada ? null : m.corpo,
    anexoMime: apagada ? null : m.anexoMime,
    anexoTamanho: apagada ? null : m.anexoTamanho,
    duracaoSeg: apagada ? null : m.duracaoSeg,
    lat: apagada ? null : m.lat,
    lng: apagada ? null : m.lng,
    ordemServicoId: m.ordemServicoId,
    respondendoA: respondendoA ?? null,
    reacoes: [],
    editadoEm: m.editadoEm?.toISOString() ?? null,
    apagadoEm: m.apagadoEm?.toISOString() ?? null,
    criadoEm: m.criadoEm.toISOString(),
  };
}

export interface AnexoMensagem {
  conversaId: string;
  dados: Buffer;
  mime: string;
}

/**
 * Bytes do anexo (foto/audio), pra rota servir com o Content-Type certo — a
 * checagem de participacao fica na rota, DEPOIS de achar a conversaId aqui
 * (mesma ordem que obterArquivoEvidencia usa: existencia antes de permissao).
 * null pra mensagem inexistente, sem anexo, ou apagada.
 */
export async function obterAnexo(mensagemId: string): Promise<AnexoMensagem | null> {
  const m = await prisma.mensagem.findUnique({
    where: { id: mensagemId },
    select: { conversaId: true, anexoDados: true, anexoMime: true, apagadoEm: true },
  });
  if (!m || m.apagadoEm || !m.anexoDados || !m.anexoMime) return null;
  return { conversaId: m.conversaId, dados: Buffer.from(m.anexoDados), mime: m.anexoMime };
}

/** Paginacao por cursor (criadoEm), mais recentes primeiro. */
export async function listarMensagens(conversaId: string, antesDe?: string, limit = 30): Promise<MensagemDTO[]> {
  const mensagens = await prisma.mensagem.findMany({
    where: { conversaId, ...(antesDe ? { criadoEm: { lt: new Date(antesDe) } } : {}) },
    orderBy: { criadoEm: "desc" },
    take: Math.min(limit, 100),
    include: {
      autor: { select: { id: true, nome: true, role: true, ultimaAtividadeEm: true } },
      respondendoA: { include: { autor: { select: { nome: true } } } },
      // Teto por mensagem: `reacoes: true` sem limite carregava TODAS as
      // reacoes de cada mensagem pra memoria. Como a chave unica e
      // (mensagem, usuario, emoji) e o emoji era string livre, dava pra criar
      // linhas sem fim numa mensagem do canal Avisos ate estourar o heap de
      // quem abrisse a conversa. Nenhuma UI mostra mais que algumas dezenas.
      reacoes: { take: LIMITE_REACOES_POR_MENSAGEM },
    },
  });

  return mensagens.map((m) => {
    const dto = paraMensagemDTO(
      m,
      m.respondendoA
        ? { id: m.respondendoA.id, autorNome: m.respondendoA.autor?.nome ?? null, resumo: resumoConteudo(m.respondendoA) }
        : null,
    );
    const porEmoji = new Map<string, string[]>();
    for (const r of m.reacoes) porEmoji.set(r.emoji, [...(porEmoji.get(r.emoji) ?? []), r.usuarioId]);
    dto.reacoes = Array.from(porEmoji, ([emoji, usuarioIds]) => ({ emoji, usuarioIds }));
    return dto;
  });
}

export async function marcarLida(conversaId: string, usuarioId: string): Promise<void> {
  await prisma.conversaParticipante.updateMany({
    where: { conversaId, usuarioId },
    data: { ultimaLeituraEm: new Date() },
  });
  const participantes = await prisma.conversaParticipante.findMany({
    where: { conversaId, saiuEm: null, usuarioId: { not: usuarioId } },
    select: { usuarioId: true },
  });
  const em = new Date().toISOString();
  for (const p of participantes) emitParaUsuario(p.usuarioId, { tipo: "chat-leitura", conversaId, autorId: usuarioId, em });
}

/** Total agregado de nao-lidas do usuario — endpoint leve pro badge (nao monta ConversaResumo inteiro). */
export async function contarNaoLidas(usuarioId: string): Promise<number> {
  const participacoes = await prisma.conversaParticipante.findMany({
    where: { usuarioId, saiuEm: null, silenciado: false },
    select: { conversaId: true, ultimaLeituraEm: true },
  });
  const totais = await Promise.all(
    participacoes.map((p) => prisma.mensagem.count({ where: whereMensagensNaoLidas(p.conversaId, p.ultimaLeituraEm) })),
  );
  return totais.reduce((acc, n) => acc + n, 0);
}

/**
 * Toggle: se o usuario ja reagiu com esse emoji, remove; senao adiciona.
 *
 * `conversaId` vem da rota (ja passou por exigirParticipacao) e AMARRA a
 * mensagem aquela conversa: sem isso, participar de uma conversa qualquer
 * autorizava reagir em mensagem de outra — e o fan-out do SSE ia pros
 * participantes da conversa alheia.
 */
export async function reagir(conversaId: string, mensagemId: string, usuarioId: string, emoji: string): Promise<void> {
  const alvo = await prisma.mensagem.findUnique({ where: { id: mensagemId }, select: { conversaId: true } });
  if (!alvo || alvo.conversaId !== conversaId) throw new HttpError(404, "Mensagem nao encontrada");

  const existente = await prisma.mensagemReacao.findUnique({
    where: { mensagemId_usuarioId_emoji: { mensagemId, usuarioId, emoji } },
  });
  if (existente) {
    await prisma.mensagemReacao.delete({ where: { id: existente.id } });
  } else {
    await prisma.mensagemReacao.create({ data: { mensagemId, usuarioId, emoji } });
  }
  const mensagem = await prisma.mensagem.findUnique({ where: { id: mensagemId }, select: { conversaId: true } });
  if (!mensagem) return;
  const participantes = await prisma.conversaParticipante.findMany({
    where: { conversaId: mensagem.conversaId, saiuEm: null },
    select: { usuarioId: true },
  });
  const em = new Date().toISOString();
  for (const p of participantes) {
    emitParaUsuario(p.usuarioId, { tipo: "chat-mensagem", conversaId: mensagem.conversaId, mensagemId, autorId: usuarioId, em });
  }
}

/** SOFT DELETE — so o autor ou um admin. A bolha vira "Mensagem apagada"; nada some do banco. */
export async function apagarMensagem(mensagemId: string, usuarioId: string, ehAdmin: boolean): Promise<void> {
  const mensagem = await prisma.mensagem.findUnique({ where: { id: mensagemId } });
  if (!mensagem) throw new HttpError(404, "Mensagem nao encontrada");
  if (mensagem.autorId !== usuarioId && !ehAdmin) throw new HttpError(403, "Voce so pode apagar suas proprias mensagens");
  await prisma.mensagem.update({ where: { id: mensagemId }, data: { apagadoEm: new Date(), apagadoPorId: usuarioId } });
  const participantes = await prisma.conversaParticipante.findMany({
    where: { conversaId: mensagem.conversaId, saiuEm: null },
    select: { usuarioId: true },
  });
  const em = new Date().toISOString();
  for (const p of participantes) {
    emitParaUsuario(p.usuarioId, { tipo: "chat-mensagem", conversaId: mensagem.conversaId, mensagemId, em });
  }
}

/** So o autor edita, e so texto (edicao de legenda/tipo com anexo nao faz parte do escopo). */
export async function editarMensagem(mensagemId: string, usuarioId: string, novoCorpo: string): Promise<MensagemDTO> {
  const mensagem = await prisma.mensagem.findUnique({ where: { id: mensagemId } });
  if (!mensagem) throw new HttpError(404, "Mensagem nao encontrada");
  if (mensagem.autorId !== usuarioId) throw new HttpError(403, "Voce so pode editar suas proprias mensagens");
  if (mensagem.apagadoEm) throw new HttpError(409, "Mensagem apagada nao pode ser editada");
  const atualizada = await prisma.mensagem.update({
    where: { id: mensagemId },
    data: { corpo: novoCorpo, editadoEm: new Date() },
    include: { autor: { select: { id: true, nome: true, role: true, ultimaAtividadeEm: true } } },
  });
  const participantes = await prisma.conversaParticipante.findMany({
    where: { conversaId: mensagem.conversaId, saiuEm: null },
    select: { usuarioId: true },
  });
  const em = new Date().toISOString();
  for (const p of participantes) {
    emitParaUsuario(p.usuarioId, { tipo: "chat-mensagem", conversaId: mensagem.conversaId, mensagemId, em });
  }
  return paraMensagemDTO(atualizada);
}

export async function emitirDigitando(conversaId: string, autorId: string): Promise<void> {
  const participantes = await prisma.conversaParticipante.findMany({
    where: { conversaId, saiuEm: null, usuarioId: { not: autorId } },
    select: { usuarioId: true },
  });
  const em = new Date().toISOString();
  for (const p of participantes) emitParaUsuario(p.usuarioId, { tipo: "chat-digitando", conversaId, autorId, em });
}

// ---- Respostas rapidas de OS (chat como ferramenta de operacao) ----

export type RespostaRapidaTipo = "a_caminho" | "cheguei" | "cliente_ausente" | "preciso_apoio";

const ROTULO_RESPOSTA_RAPIDA: Record<RespostaRapidaTipo, string> = {
  a_caminho: "A caminho",
  cheguei: "Cheguei",
  cliente_ausente: "Cliente ausente",
  preciso_apoio: "Preciso de apoio",
};

/**
 * As respostas rapidas da thread de OS EXECUTAM a acao de verdade — nao sao
 * so texto. "Preciso de apoio" nao muda status: notifica todo admin/gestor.
 * As outras tres delegam pro writebackService JA EXISTENTE (mesma rota que
 * o dialog de detalhe usa) — o OsEvento("status") sai de graca de la, nao
 * duplicamos aqui. So DEPOIS disso postamos a mensagem de sistema no chat.
 */
export async function aplicarRespostaRapidaOs(user: JwtPayload, conversaId: string, tipo: RespostaRapidaTipo): Promise<MensagemDTO> {
  const autorId = user.sub;
  const [conversa, autor] = await Promise.all([
    prisma.conversa.findUnique({ where: { id: conversaId }, select: { ordemServicoId: true } }),
    prisma.usuario.findUniqueOrThrow({ where: { id: autorId }, select: { nome: true } }),
  ]);
  if (!conversa?.ordemServicoId) throw new HttpError(400, "Esta conversa nao e uma thread de OS");
  const ordemServicoId = conversa.ordemServicoId;
  const autorNome = autor.nome;

  // Segunda guarda, deliberadamente redundante com garantirConversaDeOs: estas
  // acoes NAO sao texto — escrevem status na OS e no SGP do provedor. Ser
  // participante da conversa nao basta, porque a lista de participantes e
  // historica (quem entrou continua la depois de a OS ser reatribuida). A
  // autorizacao tem que valer AGORA, contra a OS de agora.
  const os = await prisma.ordemServico.findUnique({
    where: { id: ordemServicoId },
    select: { provedorId: true, tecnicoId: true },
  });
  if (!os) throw new HttpError(404, "Ordem de servico nao encontrada");
  if (!podeAcessarOs(user, os)) {
    throw new HttpError(403, "Acesso restrito ao proprio provedor/tecnico");
  }

  if (tipo === "a_caminho") {
    await writebackService.marcarACaminho(ordemServicoId, autorId);
  } else if (tipo === "cheguei") {
    await writebackService.mudarStatus(ordemServicoId, OsStatus.EM_EXECUCAO, autorId);
  } else if (tipo === "cliente_ausente") {
    await writebackService.mudarStatus(ordemServicoId, OsStatus.PENDENTE, autorId);
  } else {
    const gestores = await prisma.usuario.findMany({ where: { ativo: true, role: { in: ROLES_INTERNOS } }, select: { id: true } });
    await prisma.notificacao.createMany({
      data: gestores.map((g) => ({
        usuarioId: g.id,
        tipo: "mensagem",
        mensagem: `${autorNome} precisa de apoio numa OS`,
        ordemServicoId,
      })),
    });
    const em = new Date().toISOString();
    for (const g of gestores) emitParaUsuario(g.id, { tipo: "chat-mensagem", conversaId, autorId, em });
  }

  return enviarMensagem(conversaId, autorId, {
    tipo: MensagemTipo.SISTEMA,
    corpo: `${autorNome} marcou: ${ROTULO_RESPOSTA_RAPIDA[tipo]}`,
  });
}
