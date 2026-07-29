import {
  CanalWhatsapp,
  LIMITE_MIDIA_CLIENTE_BYTES,
  MensagemClienteDirecao,
  MensagemClienteTipo,
  type ConversaClienteResumo,
  type MensagemClienteDTO,
  type StatusConversaCliente,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { emitParaTodos } from "./realtimeHub.js";
import * as canaisWhatsappService from "./canaisWhatsappService.js";
import * as whatsappMeta from "../connectors/whatsappMeta.js";
import * as whatsappEvolution from "../connectors/whatsappEvolution.js";

/**
 * Chat com clientes via WhatsApp — caixa compartilhada entre todo staff
 * elegivel (nao uma DM), por isso todo evento usa emitParaTodos (nao
 * emitParaUsuario). Espelha a forma de chatService.ts, mas sobre
 * ConversaCliente/MensagemCliente (ver schema — modelos separados de
 * proposito do chat interno).
 */

function statusDaConversa(c: { agenteId: string | null; arquivada: boolean }): StatusConversaCliente {
  if (c.arquivada) return "arquivada";
  return c.agenteId ? "em_atendimento" : "fila";
}

async function paraConversaResumo(
  c: { id: string; telefone: string; nomeContato: string | null; canal: string; agenteId: string | null; arquivada: boolean; ultimaMensagemEm: Date | null; criadoEm: Date },
): Promise<ConversaClienteResumo> {
  const [ultima, agente] = await Promise.all([
    prisma.mensagemCliente.findFirst({ where: { conversaId: c.id }, orderBy: { criadoEm: "desc" } }),
    c.agenteId ? prisma.usuario.findUnique({ where: { id: c.agenteId }, select: { nome: true } }) : Promise.resolve(null),
  ]);
  return {
    id: c.id,
    telefone: c.telefone,
    nomeContato: c.nomeContato,
    canal: c.canal as CanalWhatsapp,
    status: statusDaConversa(c),
    agenteId: c.agenteId,
    agenteNome: agente?.nome ?? null,
    ultimaMensagem: ultima
      ? { corpo: ultima.corpo, tipo: ultima.tipo as MensagemClienteTipo, direcao: ultima.direcao as MensagemClienteDirecao, criadoEm: ultima.criadoEm.toISOString() }
      : null,
    naoLidas: 0, // sem watermark de leitura ainda — ver "fora de escopo" do plano
    atualizadoEm: (c.ultimaMensagemEm ?? c.criadoEm).toISOString(),
  };
}

export async function listarConversas(opts: { fila?: boolean; agenteId?: string; arquivada?: boolean } = {}): Promise<ConversaClienteResumo[]> {
  const where = {
    arquivada: opts.arquivada ?? false,
    ...(opts.fila ? { agenteId: null } : {}),
    ...(opts.agenteId ? { agenteId: opts.agenteId } : {}),
  };
  const conversas = await prisma.conversaCliente.findMany({ where, orderBy: { ultimaMensagemEm: "desc" } });
  return Promise.all(conversas.map(paraConversaResumo));
}

function paraMensagemDTO(m: {
  id: string;
  conversaId: string;
  canal: string;
  direcao: string;
  autorId: string | null;
  autor: { nome: string } | null;
  tipo: string;
  corpo: string | null;
  anexoMime: string | null;
  anexoTamanho: number | null;
  duracaoSeg: number | null;
  lat: number | null;
  lng: number | null;
  falhaEnvio: string | null;
  criadoEm: Date;
}): MensagemClienteDTO {
  return {
    id: m.id,
    conversaId: m.conversaId,
    canal: m.canal as CanalWhatsapp,
    direcao: m.direcao as MensagemClienteDirecao,
    autorId: m.autorId,
    autorNome: m.autor?.nome ?? null,
    tipo: m.tipo as MensagemClienteTipo,
    corpo: m.corpo,
    anexoMime: m.anexoMime,
    anexoTamanho: m.anexoTamanho,
    duracaoSeg: m.duracaoSeg,
    lat: m.lat,
    lng: m.lng,
    falhaEnvio: m.falhaEnvio,
    criadoEm: m.criadoEm.toISOString(),
  };
}

export async function listarMensagens(conversaId: string, antesDe?: string, limit = 30): Promise<MensagemClienteDTO[]> {
  const mensagens = await prisma.mensagemCliente.findMany({
    where: { conversaId, ...(antesDe ? { criadoEm: { lt: new Date(antesDe) } } : {}) },
    orderBy: { criadoEm: "desc" },
    take: Math.min(limit, 100),
    include: { autor: { select: { nome: true } } },
  });
  return mensagens.map(paraMensagemDTO).reverse();
}

/** Envia uma mensagem de texto do staff pro cliente — despacha pro connector do canal da conversa. */
export async function enviarMensagem(conversaId: string, autorId: string, corpo: string): Promise<MensagemClienteDTO> {
  const conversa = await prisma.conversaCliente.findUnique({ where: { id: conversaId } });
  if (!conversa) throw new HttpError(404, "Conversa nao encontrada");

  const canal = conversa.canal as CanalWhatsapp;
  const config = await canaisWhatsappService.getConfig(canal);
  const resultado = !config
    ? { ok: false, erro: "Canal nao configurado" }
    : config.tipo === "meta"
      ? await whatsappMeta.enviarTexto(config, conversa.telefone, corpo)
      : await whatsappEvolution.enviarTexto(config, conversa.telefone, corpo);

  const criada = await prisma.mensagemCliente.create({
    data: {
      conversaId,
      canal: conversa.canal,
      direcao: MensagemClienteDirecao.SAIDA,
      autorId,
      tipo: MensagemClienteTipo.TEXTO,
      corpo,
      // Envio falho ainda registra na thread (com falhaEnvio) — nunca descarta silenciosamente.
      waMessageId: resultado.waMessageId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      falhaEnvio: resultado.ok ? null : (resultado.erro ?? "Falha ao enviar"),
    },
    include: { autor: { select: { nome: true } } },
  });
  await prisma.conversaCliente.update({ where: { id: conversaId }, data: { ultimaMensagemEm: new Date() } });

  const dto = paraMensagemDTO(criada);
  emitParaTodos({ tipo: "cliente-chat-mensagem", conversaId, mensagemId: criada.id, autorId, em: new Date().toISOString() });
  return dto;
}

/** Reivindica uma conversa da fila compartilhada — 409 se outro agente ja assumiu (corrida). */
export async function assumir(conversaId: string, agenteId: string): Promise<void> {
  const resultado = await prisma.conversaCliente.updateMany({ where: { id: conversaId, agenteId: null }, data: { agenteId } });
  if (resultado.count === 0) throw new HttpError(409, "Esta conversa ja foi assumida por outro atendente");
  emitParaTodos({ tipo: "cliente-chat-conversa", conversaId, em: new Date().toISOString() });
}

export async function transferir(conversaId: string, novoAgenteId: string): Promise<void> {
  await prisma.conversaCliente.update({ where: { id: conversaId }, data: { agenteId: novoAgenteId } });
  emitParaTodos({ tipo: "cliente-chat-conversa", conversaId, em: new Date().toISOString() });
}

export async function encerrar(conversaId: string): Promise<void> {
  await prisma.conversaCliente.update({ where: { id: conversaId }, data: { arquivada: true } });
  emitParaTodos({ tipo: "cliente-chat-conversa", conversaId, em: new Date().toISOString() });
}

export interface AnexoMensagemCliente {
  dados: Buffer;
  mime: string;
}

export async function obterAnexo(mensagemId: string): Promise<AnexoMensagemCliente | null> {
  const m = await prisma.mensagemCliente.findUnique({ where: { id: mensagemId }, select: { anexoDados: true, anexoMime: true } });
  if (!m?.anexoDados || !m.anexoMime) return null;
  return { dados: Buffer.from(m.anexoDados), mime: m.anexoMime };
}

/**
 * Ingestao de uma mensagem recebida via webhook (Meta ou Evolution) — chamada
 * pela rota de webhook DEPOIS da assinatura ja validada. Idempotente via
 * upsert em (canal, waMessageId): webhooks WhatsApp reentregam o mesmo evento,
 * entao isto e o que evita duplicar a mensagem na thread.
 */
export async function receberMensagemWebhook(input: {
  canal: CanalWhatsapp;
  telefone: string;
  nomeContato?: string | null;
  waMessageId: string;
  tipo: MensagemClienteTipo;
  corpo?: string | null;
  midia?: { dados: Buffer; mime: string } | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<void> {
  const conversa = await prisma.conversaCliente.upsert({
    where: { telefone_canal: { telefone: input.telefone, canal: input.canal } },
    create: { telefone: input.telefone, canal: input.canal, nomeContato: input.nomeContato ?? null },
    update: { nomeContato: input.nomeContato ?? undefined, ultimaMensagemEm: new Date() },
  });

  const midiaDentroDoTeto = input.midia && input.midia.dados.byteLength <= LIMITE_MIDIA_CLIENTE_BYTES;
  const midiaRejeitada = input.midia && !midiaDentroDoTeto;

  const mensagem = await prisma.mensagemCliente.upsert({
    where: { canal_waMessageId: { canal: input.canal, waMessageId: input.waMessageId } },
    create: {
      conversaId: conversa.id,
      canal: input.canal,
      direcao: MensagemClienteDirecao.ENTRADA,
      tipo: input.tipo,
      corpo: midiaRejeitada ? "Midia muito grande — veja no WhatsApp" : (input.corpo ?? null),
      anexoDados: midiaDentroDoTeto ? new Uint8Array(input.midia!.dados) : undefined,
      anexoMime: midiaDentroDoTeto ? input.midia!.mime : undefined,
      anexoTamanho: midiaDentroDoTeto ? input.midia!.dados.byteLength : undefined,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      waMessageId: input.waMessageId,
    },
    // Redelivery do mesmo evento: nao altera nada, so devolve a linha existente.
    update: {},
  });
  await prisma.conversaCliente.update({ where: { id: conversa.id }, data: { ultimaMensagemEm: new Date() } });

  emitParaTodos({ tipo: "cliente-chat-mensagem", conversaId: conversa.id, mensagemId: mensagem.id, em: new Date().toISOString() });
}
