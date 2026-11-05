import {
  CanalWhatsapp,
  LIMITE_MIDIA_CLIENTE_BYTES,
  MensagemClienteDirecao,
  MensagemClienteTipo,
  OrigemConversaCliente,
  UserRole,
  type ConversaClienteResumo,
  type FiltroConversaCliente,
  type IniciarConversaClienteInput,
  type MensagemClienteDTO,
  type StatusConversaCliente,
  type TemplateWhatsappDTO,
} from "@isphub/shared";
import type { ConversaCliente, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import type { JwtPayload } from "./authService.js";
import { emitParaTodos } from "./realtimeHub.js";
import { dispararPush } from "./pushService.js";
import * as canaisWhatsappService from "./canaisWhatsappService.js";
import * as whatsappMeta from "../connectors/whatsappMeta.js";
import * as whatsappEvolution from "../connectors/whatsappEvolution.js";
import * as clienteAtendai from "./clienteAtendaiService.js";
import { podeProvedor, provedoresDoUsuario } from "./escopoService.js";

/**
 * Chat com clientes via WhatsApp — caixa compartilhada entre todo staff
 * elegivel (nao uma DM), por isso todo evento usa emitParaTodos (nao
 * emitParaUsuario). Espelha a forma de chatService.ts, mas sobre
 * ConversaCliente/MensagemCliente (ver schema — modelos separados de
 * proposito do chat interno).
 */

/**
 * Escopo de visibilidade da caixa por papel, no molde do escopoService.ts
 * (fragmento de `where` + predicado + guard assincrono). A chave e
 * `iniciadaPorId`, NAO `agenteId`: transferir uma conversa troca o agente e
 * tiraria do tecnico justamente a conversa que ele abriu.
 *
 * - ADMIN/GESTOR: veem todas e podem intervir (ver enviarMensagem). O GESTOR
 *   limitado a alguns provedores ve as deles, mais o que ele iniciou ou esta
 *   com ele (conversa sem provedor so nesses dois casos).
 * - TECNICO: o que ele mesmo iniciou OU o que esta com ele agora (abriu pela
 *   OS ou recebeu por transferencia) — nao ve fila nem conversa entrante.
 * - ATENDENTE: as conversas pelo AtendAI do provedor dela.
 * - PROVEDOR: fora do modulo.
 */
export function escopoConversaClienteWhere(user: JwtPayload): Record<string, unknown> {
  if (user.role === UserRole.ADMIN || user.role === UserRole.GESTOR) {
    const lista = provedoresDoUsuario(user);
    return lista ? { OR: [{ provedorId: { in: lista } }, { iniciadaPorId: user.sub }, { agenteId: user.sub }] } : {};
  }
  // Sentinela pro PROVEDOR (mesma ideia do escopoOsWhere): o router ja barra o
  // papel, mas um papel sem lugar no modulo nunca pode cair no `{}` e enxergar
  // a caixa inteira se um caminho novo esquecer aquele guard.
  if (user.role === UserRole.PROVEDOR) return { iniciadaPorId: "__nenhum__" };
  if (user.role === UserRole.ATENDENTE) return { canal: CanalWhatsapp.ATENDAI, provedorId: user.provedorId ?? "__nenhum__" };
  return { OR: [{ iniciadaPorId: user.sub }, { agenteId: user.sub }] };
}

/** Confere se o usuario pode ler/agir numa conversa especifica (fora de listagem). */
export function podeAcessarConversaCliente(
  user: JwtPayload,
  conversa: { iniciadaPorId: string | null; agenteId?: string | null; canal?: string; provedorId?: string | null },
): boolean {
  if (user.role === UserRole.ADMIN || user.role === UserRole.GESTOR) {
    if (!provedoresDoUsuario(user)) return true;
    if (conversa.provedorId && podeProvedor(user, conversa.provedorId)) return true;
    return conversa.iniciadaPorId === user.sub || (!!conversa.agenteId && conversa.agenteId === user.sub);
  }
  if (user.role === UserRole.PROVEDOR) return false;
  if (user.role === UserRole.ATENDENTE) {
    return conversa.canal === CanalWhatsapp.ATENDAI && !!user.provedorId && conversa.provedorId === user.provedorId;
  }
  // Entrante tem iniciadaPorId e agenteId null: e da fila, e a fila nao e do tecnico.
  return (conversa.iniciadaPorId !== null && conversa.iniciadaPorId === user.sub) || (!!conversa.agenteId && conversa.agenteId === user.sub);
}

/**
 * Guard de toda rota que fala de UMA conversa. Devolve a conversa carregada
 * pra quem chamou nao precisar de um segundo findUnique.
 */
export async function exigirAcessoConversaCliente(user: JwtPayload, conversaId: string): Promise<ConversaCliente> {
  const conversa = await prisma.conversaCliente.findUnique({ where: { id: conversaId } });
  if (!conversa) throw new HttpError(404, "Conversa nao encontrada");
  if (!podeAcessarConversaCliente(user, conversa)) {
    throw new HttpError(403, "Acesso restrito as conversas que voce iniciou");
  }
  return conversa;
}

/**
 * `where` da listagem: escopo do papel + o filtro da tela. O filtro do cliente
 * so ESTREITA, nunca alarga (mesmo precedente do `tecnicoId` da query em
 * fila.ts): `todas` nao remove nada do escopo, entao pra ADMIN/GESTOR e a caixa
 * inteira e pro TECNICO ja sai reduzido as conversas que ele iniciou —
 * inclusive as que ele abriu e foram transferidas, que `minhas` (agenteId)
 * esconderia.
 */
export function whereConversasCliente(user: JwtPayload, filtro: FiltroConversaCliente): Prisma.ConversaClienteWhereInput {
  return {
    arquivada: false,
    ...escopoConversaClienteWhere(user),
    ...(filtro === "fila" ? { agenteId: null } : {}),
    ...(filtro === "minhas" ? { agenteId: user.sub } : {}),
  };
}

function statusDaConversa(c: { agenteId: string | null; arquivada: boolean }): StatusConversaCliente {
  if (c.arquivada) return "arquivada";
  return c.agenteId ? "em_atendimento" : "fila";
}

/** Janela de atendimento livre do WhatsApp: fora dela a Meta so aceita template. */
const JANELA_ATENDIMENTO_MS = 24 * 60 * 60 * 1000;

interface ConversaComRelacoes {
  id: string;
  telefone: string;
  nomeContato: string | null;
  canal: string;
  agenteId: string | null;
  iniciadaPorId: string | null;
  origem: string;
  arquivada: boolean;
  ultimaMensagemEm: Date | null;
  criadoEm: Date;
  agente: { nome: string } | null;
  iniciadaPor: { nome: string } | null;
}

/**
 * Monta os resumos do conjunto INTEIRO em lote. Antes era um findFirst por
 * conversa dentro de um Promise.all (2N idas ao banco); com `dentroJanela24h`
 * viraria 3N — numa caixa de 200 conversas, a diferenca entre 3 e 600 queries
 * a cada abertura de tela. Os nomes de agente/iniciadaPor vem por join no
 * findMany de quem chama, nao por query extra.
 */
async function montarResumos(conversas: ConversaComRelacoes[]): Promise<ConversaClienteResumo[]> {
  if (conversas.length === 0) return [];
  const ids = conversas.map((c) => c.id);

  const [marcos, comEntradaRecente] = await Promise.all([
    prisma.mensagemCliente.groupBy({ by: ["conversaId"], where: { conversaId: { in: ids } }, _max: { criadoEm: true } }),
    // Janela de 24h: basta EXISTIR entrada recente, entao um GROUP BY resolve
    // o conjunto todo — nunca carregar as mensagens so pra saber disso.
    prisma.mensagemCliente.groupBy({
      by: ["conversaId"],
      where: {
        conversaId: { in: ids },
        direcao: MensagemClienteDirecao.ENTRADA,
        criadoEm: { gte: new Date(Date.now() - JANELA_ATENDIMENTO_MS) },
      },
      _count: true,
    }),
  ]);

  const alvos = marcos.flatMap((m) => (m._max.criadoEm ? [{ conversaId: m.conversaId, criadoEm: m._max.criadoEm }] : []));
  const ultimas = alvos.length
    ? await prisma.mensagemCliente.findMany({
        where: { OR: alvos },
        select: { conversaId: true, corpo: true, tipo: true, direcao: true, criadoEm: true },
      })
    : [];

  const ultimaPorConversa = new Map<string, (typeof ultimas)[number]>();
  // Duas mensagens no mesmo instante empatam no _max — a primeira ja serve.
  for (const m of ultimas) if (!ultimaPorConversa.has(m.conversaId)) ultimaPorConversa.set(m.conversaId, m);
  const janelaAberta = new Set(comEntradaRecente.map((g) => g.conversaId));

  return conversas.map((c) => {
    const ultima = ultimaPorConversa.get(c.id);
    return {
      id: c.id,
      telefone: c.telefone,
      nomeContato: c.nomeContato,
      canal: c.canal as CanalWhatsapp,
      status: statusDaConversa(c),
      agenteId: c.agenteId,
      agenteNome: c.agente?.nome ?? null,
      origem: c.origem as OrigemConversaCliente,
      iniciadaPorId: c.iniciadaPorId,
      iniciadaPorNome: c.iniciadaPor?.nome ?? null,
      dentroJanela24h: janelaAberta.has(c.id),
      ultimaMensagem: ultima
        ? {
            corpo: ultima.corpo,
            tipo: ultima.tipo as MensagemClienteTipo,
            direcao: ultima.direcao as MensagemClienteDirecao,
            criadoEm: ultima.criadoEm.toISOString(),
          }
        : null,
      naoLidas: 0, // sem watermark de leitura ainda — ver "fora de escopo" do plano
      atualizadoEm: (c.ultimaMensagemEm ?? c.criadoEm).toISOString(),
    };
  });
}

const RELACOES_RESUMO = { agente: { select: { nome: true } }, iniciadaPor: { select: { nome: true } } } as const;

export async function listarConversas(user: JwtPayload, filtro: FiltroConversaCliente): Promise<ConversaClienteResumo[]> {
  const conversas = await prisma.conversaCliente.findMany({
    where: whereConversasCliente(user, filtro),
    orderBy: { ultimaMensagemEm: "desc" },
    include: RELACOES_RESUMO,
  });
  return montarResumos(conversas);
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
  templateNome: string | null;
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
    templateNome: m.templateNome,
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

/**
 * Envia uma mensagem de texto do staff pro cliente — despacha pro connector do
 * canal da conversa. Nao mexe em `agenteId` de proposito: e isso que faz a
 * INTERVENCAO de ADMIN/GESTOR (escrever numa conversa de outro atendente sem
 * tomar a conversa pra si) ser so uma questao de quem passa pelo guard da rota.
 * Trocar de dono e acao explicita e separada: `transferir`.
 */
export async function enviarMensagem(conversaId: string, autorId: string, corpo: string): Promise<MensagemClienteDTO> {
  const conversa = await prisma.conversaCliente.findUnique({ where: { id: conversaId } });
  if (!conversa) throw new HttpError(404, "Conversa nao encontrada");

  const canal = conversa.canal as CanalWhatsapp;
  let resultado: { ok: boolean; waMessageId?: string; erro?: string };
  if (canal === CanalWhatsapp.ATENDAI) {
    resultado = await clienteAtendai.enviarPeloAtendai(conversa, autorId, corpo);
  } else {
    const config = await canaisWhatsappService.getConfig(canal);
    resultado = !config
      ? { ok: false, erro: "Canal nao configurado" }
      : config.tipo === "meta"
        ? await whatsappMeta.enviarTexto(config, conversa.telefone, corpo)
        : await whatsappEvolution.enviarTexto(config, conversa.telefone, corpo);
  }

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
  // Escrever reabre: no AtendAI a conversa volta para a pessoa daqui (IA quieta),
  // entao aqui ela tambem tem que voltar a receber as respostas do cliente.
  await prisma.conversaCliente.update({
    where: { id: conversaId },
    data: { ultimaMensagemEm: new Date(), ...(canal === CanalWhatsapp.ATENDAI && resultado.ok ? { arquivada: false } : {}) },
  });

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
  // O destino precisa ser staff ATIVO e de um papel que este modulo aceita. Sem
  // esta checagem: id inexistente estourava violacao de FK do Prisma (500 opaco
  // em vez de 400), e o id de um PROVEDOR ou de um usuario desativado era aceito
  // — a conversa ficaria atribuida a alguem que o proprio router barra na
  // entrada, ou seja, sem dono capaz de atende-la e invisivel pra todo tecnico.
  const destino = await prisma.usuario.findFirst({
    where: {
      id: novoAgenteId,
      ativo: true,
      role: { in: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO] },
    },
    select: { id: true },
  });
  if (!destino) {
    throw new HttpError(400, "Destino invalido: escolha um usuario ativo da equipe.");
  }

  await prisma.conversaCliente.update({ where: { id: conversaId }, data: { agenteId: novoAgenteId } });
  emitParaTodos({ tipo: "cliente-chat-conversa", conversaId, em: new Date().toISOString() });
}

export async function encerrar(conversaId: string): Promise<void> {
  const conversa = await prisma.conversaCliente.findUnique({ where: { id: conversaId } });
  if (!conversa) throw new HttpError(404, "Conversa nao encontrada");
  // Pelo AtendAI: a IA de la volta a atender o cliente. Falhou la, nao arquiva
  // aqui — senao a IA ficaria calada com ninguem atendendo.
  if (conversa.canal === CanalWhatsapp.ATENDAI) await clienteAtendai.encerrarNoAtendai(conversa);
  await prisma.conversaCliente.update({ where: { id: conversaId }, data: { arquivada: true } });
  emitParaTodos({ tipo: "cliente-chat-conversa", conversaId, em: new Date().toISOString() });
}

export interface AnexoMensagemCliente {
  dados: Buffer;
  mime: string;
}

/**
 * Conversa dona de uma mensagem — o anexo e baixado por mensagemId, entao a
 * rota precisa disto pra aplicar o mesmo escopo das rotas de conversa antes de
 * entregar bytes.
 */
export async function conversaDaMensagem(mensagemId: string): Promise<string | null> {
  const m = await prisma.mensagemCliente.findUnique({ where: { id: mensagemId }, select: { conversaId: true } });
  return m?.conversaId ?? null;
}

export async function obterAnexo(mensagemId: string): Promise<AnexoMensagemCliente | null> {
  const m = await prisma.mensagemCliente.findUnique({ where: { id: mensagemId }, select: { anexoDados: true, anexoMime: true } });
  if (!m?.anexoDados || !m.anexoMime) return null;
  return { dados: Buffer.from(m.anexoDados), mime: m.anexoMime };
}

/**
 * Config do canal Meta pronta pra falar de template. Falta de WABA ID e erro do
 * OPERADOR, nao do sistema: 400 com o caminho da tela, senao a tela de
 * templates so mostra "erro interno" e ninguem descobre o que configurar.
 */
async function configDeTemplates(): Promise<{ config: canaisWhatsappService.MetaWhatsappConfig; wabaId: string }> {
  const config = await canaisWhatsappService.getConfig(CanalWhatsapp.META);
  if (!config || config.tipo !== "meta") {
    throw new HttpError(400, "Canal WhatsApp Oficial nao configurado ou inativo. Configure em Administracao > Canais WhatsApp.");
  }
  if (!config.wabaId) {
    throw new HttpError(400, "Templates indisponiveis: configure o WABA ID em Administracao > Canais WhatsApp.");
  }
  return { config, wabaId: config.wabaId };
}

/** Erro do connector (Graph API fora do ar, token expirado) vira 502 — mesma conversao do writebackService. */
function erroDaMeta(err: unknown, acao: string): HttpError {
  if (err instanceof HttpError) return err;
  return new HttpError(502, `${acao}: ${err instanceof Error ? err.message : "falha na comunicacao com a Meta"}`);
}

/** Catalogo HSM lido ao vivo da Meta (o cache de 5 min vive no connector). */
export async function listarTemplates(): Promise<TemplateWhatsappDTO[]> {
  const { config, wabaId } = await configDeTemplates();
  try {
    const defs = await whatsappMeta.listarTemplates(config, wabaId);
    return defs.map((d) => ({
      nome: d.nome,
      idioma: d.idioma,
      categoria: d.categoria,
      corpo: d.corpo,
      header: d.header,
      variaveis: d.variaveis,
    }));
  } catch (err) {
    throw erroDaMeta(err, "Nao foi possivel ler os templates na Meta");
  }
}

/** E.164 brasileiro sem "+": 55 + DDD + 8 ou 9 digitos. */
const RE_TELEFONE_BR = /^55\d{10,11}$/;

function telefoneValidado(bruto: string): string {
  // normalizarTelefoneBR so formata (sempre devolve digitos), quem julga se o
  // numero existe e este teste. Um digito a mais nao pode virar template PAGO
  // disparado pro vazio e uma thread orfa no banco.
  const normalizado = whatsappMeta.normalizarTelefoneBR(bruto);
  if (!RE_TELEFONE_BR.test(normalizado)) {
    throw new HttpError(400, "Telefone invalido. Informe DDD + numero, ex.: (84) 99999-9999.");
  }
  return normalizado;
}

/**
 * Casa as variaveis recebidas com as que o template EXIGE. Devolve so os
 * indices declarados: o que veio a mais e descartado, pra nao mandar parametro
 * inventado pra Meta (ela rejeita a mensagem inteira por contagem errada).
 */
function variaveisDoTemplate(def: whatsappMeta.TemplateWhatsappDef, recebidas: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = {};
  const faltando: number[] = [];
  for (const indice of def.variaveis) {
    const valor = recebidas[String(indice)]?.trim();
    if (valor) vars[String(indice)] = valor;
    else faltando.push(indice);
  }
  if (faltando.length > 0) {
    throw new HttpError(400, `Preencha as variaveis do template: ${faltando.map((i) => `{{${i}}}`).join(", ")}`);
  }
  return vars;
}

/**
 * Abre (ou reaquece) uma conversa disparando um template HSM. Unico caminho de
 * primeiro contato: fora da janela de 24h a Meta so aceita template.
 */
export async function iniciarConversa(user: JwtPayload, input: IniciarConversaClienteInput): Promise<ConversaClienteResumo> {
  // Template e conceito da API oficial; a Evolution nao tem equivalente.
  if (input.canal !== CanalWhatsapp.META) {
    throw new HttpError(400, "Iniciar conversa por template so e possivel no canal WhatsApp Oficial.");
  }
  const { config, wabaId } = await configDeTemplates();
  const telefone = telefoneValidado(input.telefone);

  let def: whatsappMeta.TemplateWhatsappDef | null;
  try {
    def = await whatsappMeta.obterTemplate(config, wabaId, input.templateNome);
  } catch (err) {
    throw erroDaMeta(err, "Nao foi possivel ler o template na Meta");
  }
  // Sem fallback cego: template recem-rejeitado pela Meta some do catalogo, e
  // disparar "algum outro" mandaria pro cliente um texto que ninguem escolheu.
  if (!def) {
    throw new HttpError(400, `Template "${input.templateNome}" nao existe ou nao esta aprovado na Meta. Recarregue a lista de templates.`);
  }
  const vars = variaveisDoTemplate(def, input.vars ?? {});

  // Envia ANTES de tocar no banco — ao contrario do enviarMensagem, que grava a
  // bolha com falhaEnvio pra nao perder o texto ja digitado. Aqui a falha nao
  // pode deixar rastro: conversa e unica por (telefone, canal), entao um numero
  // errado viraria uma thread orfa permanente, impossivel de reaproveitar.
  let envio: Awaited<ReturnType<typeof whatsappMeta.enviarTemplate>>;
  try {
    envio = await whatsappMeta.enviarTemplate(config, telefone, def, vars);
  } catch (err) {
    // O connector cancela o disparo (em vez de devolver ok:false) quando a
    // definicao aprovada vem sem idioma — sem este ramo isso viraria 500.
    throw erroDaMeta(err, "Falha ao enviar o template");
  }
  if (!envio.ok) {
    throw new HttpError(502, `Falha ao enviar o template: ${envio.erro ?? "erro desconhecido na Meta"}`);
  }

  const agora = new Date();
  const chave = { telefone_canal_canalRef: { telefone, canal: CanalWhatsapp.META, canalRef: "" } };
  const existente = await prisma.conversaCliente.findUnique({ where: chave, select: { agenteId: true } });
  const conversa = await prisma.conversaCliente.upsert({
    where: chave,
    create: {
      telefone,
      canal: CanalWhatsapp.META,
      nomeContato: input.nomeContato ?? null,
      agenteId: user.sub,
      iniciadaPorId: user.sub,
      origem: OrigemConversaCliente.SAIDA,
      ultimaMensagemEm: agora,
    },
    update: {
      arquivada: false,
      nomeContato: input.nomeContato ?? undefined,
      ultimaMensagemEm: agora,
      // Adota so o que estava sem dono. `iniciadaPorId` fica intacto de
      // proposito: ha uma unica thread por (telefone, canal) e sobrescrever
      // roubaria do tecnico que a abriu a unica conversa que ele enxerga.
      agenteId: existente?.agenteId ?? user.sub,
    },
    include: RELACOES_RESUMO,
  });

  const mensagem = await prisma.mensagemCliente.create({
    data: {
      conversaId: conversa.id,
      canal: CanalWhatsapp.META,
      direcao: MensagemClienteDirecao.SAIDA,
      autorId: user.sub,
      tipo: MensagemClienteTipo.TEXTO,
      // Corpo ja renderizado: o atendente precisa reler exatamente o que o
      // cliente recebeu, nao o marcador do template.
      corpo: envio.corpoRenderizado,
      templateNome: def.nome,
      templateVars: vars,
      waMessageId: envio.waMessageId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });

  const em = agora.toISOString();
  // Dois eventos: a thread pode ser NOVA, e quem so escuta `mensagem` nao tem
  // onde encaixa-la — `conversa` e o que faz a lista buscar de novo.
  emitParaTodos({ tipo: "cliente-chat-conversa", conversaId: conversa.id, em });
  emitParaTodos({ tipo: "cliente-chat-mensagem", conversaId: conversa.id, mensagemId: mensagem.id, autorId: user.sub, em });

  const [resumo] = await montarResumos([conversa]);
  return resumo;
}

/**
 * Ingestao de uma mensagem recebida via webhook (Meta ou Evolution) — chamada
 * pela rota de webhook DEPOIS da assinatura ja validada. Idempotente via
 * upsert em (canal, waMessageId): webhooks WhatsApp reentregam o mesmo evento,
 * entao isto e o que evita duplicar a mensagem na thread.
 *
 * Sem usuario logado de proposito: nao existe JwtPayload neste caminho e
 * nenhum guard de escopo cabe aqui — a mensagem do cliente entra sempre.
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
    where: { telefone_canal_canalRef: { telefone: input.telefone, canal: input.canal, canalRef: "" } },
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

  // Push SO quando a mensagem e nova. O upsert acima e idempotente de proposito
  // (a Meta reentrega o mesmo evento), mas ele devolve a linha existente sem
  // dizer se criou — e sem esta guarda cada reentrega tocaria o celular de todo
  // mundo de novo pela MESMA mensagem do cliente.
  const recemCriada = Date.now() - mensagem.criadoEm.getTime() < 10_000;
  if (recemCriada) {
    dispararPush(await destinatariosDaConversa(conversa), {
      titulo: conversa.nomeContato?.trim() || conversa.telefone,
      corpo: resumoMensagemCliente(mensagem.tipo, mensagem.corpo),
      dados: { tela: "chat-clientes", conversaId: conversa.id },
    });
  }
}

/**
 * Rotulo curto pro push quando a mensagem nao e texto. `tipo` como string
 * porque aqui chega o enum do Prisma, que o TS trata como distinto do enum do
 * shared mesmo tendo os mesmos valores.
 */
function resumoMensagemCliente(tipo: string, corpo: string | null): string {
  if (corpo?.trim()) return corpo.length > 120 ? `${corpo.slice(0, 120)}…` : corpo;
  switch (tipo) {
    case MensagemClienteTipo.IMAGEM:
      return "Enviou uma imagem";
    case MensagemClienteTipo.AUDIO:
      return "Enviou um áudio";
    case MensagemClienteTipo.DOCUMENTO:
      return "Enviou um documento";
    case MensagemClienteTipo.LOCALIZACAO:
      return "Enviou uma localização";
    default:
      return "Nova mensagem";
  }
}

/**
 * Quem deve ser avisado de uma mensagem do cliente — espelha a MESMA regra de
 * visibilidade da listagem (ver escopo por papel no topo do arquivo). Avisar
 * quem nao pode abrir a conversa seria pior que nao avisar: o celular toca e a
 * tela diz "acesso restrito".
 *
 * Com dono definido, so o dono: quando alguem ja assumiu, tocar o celular da
 * empresa inteira a cada resposta do cliente e o caminho mais rapido pra equipe
 * desligar a notificacao.
 */
async function destinatariosDaConversa(conversa: { agenteId: string | null; iniciadaPorId: string | null }): Promise<string[]> {
  if (conversa.agenteId) return [conversa.agenteId];
  const internos = await prisma.usuario.findMany({
    where: { ativo: true, role: { in: [UserRole.ADMIN, UserRole.GESTOR] } },
    select: { id: true },
  });
  const ids = internos.map((u) => u.id);
  // O tecnico que abriu por template continua enxergando a conversa dele.
  if (conversa.iniciadaPorId) ids.push(conversa.iniciadaPorId);
  return ids;
}
