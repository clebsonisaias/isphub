import { CanalWhatsapp, MensagemClienteDirecao, MensagemClienteTipo, OrigemConversaCliente, OsStatus, UserRole, haversineMetros } from "@isphub/shared";
import type { ConversaCliente } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { normalizarTelefoneBR } from "../connectors/whatsappMeta.js";
import type { JwtPayload } from "./authService.js";
import { AtendaiIndisponivel, chamar, credencialDoProvedor, type CredencialAtendai } from "./atendaiService.js";
import { podeAcessarOs } from "./escopoService.js";
import { cadastrarNoAtendai } from "./ponteChatAtendaiService.js";
import { emitParaTodos } from "./realtimeHub.js";
import { dispararPush } from "./pushService.js";
import { tratarRespostaConfirmacao, enviarMensagemParaCliente } from "./confirmacaoVisitaService.js";
import { calcularRotaComTransito } from "../integrations/rotas/tomTomRouting.js";

/**
 * CONVERSA COM O CLIENTE DA OS PELO NUMERO DA EMPRESA (aprovado em 23/10/2026).
 *
 * O tecnico (ou a atendente) fala com o cliente da OS pelo WhatsApp do AtendAI
 * do provedor — o mesmo numero da CláudIA. O canal fica no cadastro do provedor
 * (`AtendaiConfig.canalClientesId`): quem fala com cliente da NetGo sai sempre
 * pelo canal da NetGo. Enquanto a pessoa daqui conversa, a IA de la fica quieta;
 * "Encerrar" devolve o cliente a IA.
 *
 * Primeira versao: so texto. Foto ou audio do cliente chegam como aviso.
 */

/** Modelo aprovado na Meta para abrir conversa fora da janela de 24h (p1 = cliente, p2 = quem fala). */
const MODELO_PRIMEIRO_CONTATO = "tecnico_contato";

export interface CanalAtendai {
  id: string;
  tipo: string;
  nome: string;
}

/** Erro do AtendAI vira mensagem que a pessoa entende, sem esconder o motivo de la. */
function erroDoAtendai(e: unknown): never {
  if (e instanceof HttpError) throw e;
  if (e instanceof AtendaiIndisponivel) {
    throw new HttpError(e.status >= 400 && e.status < 500 ? 422 : 502, `AtendAI: ${e.message}`);
  }
  throw new HttpError(502, "O AtendAI não respondeu. Tente de novo em instantes.");
}

async function credencialOuErro(provedorId: string): Promise<CredencialAtendai> {
  const cred = await credencialDoProvedor(provedorId);
  if (!cred) throw new HttpError(409, "Este provedor ainda não tem o AtendAI cadastrado.");
  return cred;
}

/** Os canais de WhatsApp do AtendAI do provedor, e qual esta escolhido para falar com cliente. */
export async function canaisDoProvedor(provedorId: string): Promise<{ itens: CanalAtendai[]; atual: { id: string; nome: string } | null }> {
  const cred = await credencialOuErro(provedorId);
  const r = await chamar<{ itens: CanalAtendai[] }>(cred, "GET", "/canais").catch(erroDoAtendai);
  const cfg = await prisma.atendaiConfig.findUnique({
    where: { provedorId },
    select: { canalClientesId: true, canalClientesNome: true },
  });
  const atual = cfg?.canalClientesId ? { id: cfg.canalClientesId, nome: cfg.canalClientesNome ?? cfg.canalClientesId } : null;
  return { itens: r.itens, atual };
}

/** Escolhe (ou tira, com `null`) o canal por onde saem as conversas com os clientes do provedor. */
export async function definirCanalClientes(provedorId: string, canalId: string | null): Promise<{ id: string; nome: string } | null> {
  if (canalId === null) {
    await prisma.atendaiConfig.update({ where: { provedorId }, data: { canalClientesId: null, canalClientesNome: null } });
    return null;
  }
  const { itens } = await canaisDoProvedor(provedorId);
  const canal = itens.find((c) => c.id === canalId);
  if (!canal) throw new HttpError(400, "Esse canal não existe (ou está inativo) no AtendAI deste provedor.");
  await prisma.atendaiConfig.update({ where: { provedorId }, data: { canalClientesId: canal.id, canalClientesNome: canal.nome } });
  return { id: canal.id, nome: canal.nome };
}

/** Celular do cliente no formato 55+DDD+numero, ou null se o da OS nao servir. */
export function telefoneDaOs(bruto: string | null | undefined): string | null {
  if (!bruto?.trim()) return null;
  const n = normalizarTelefoneBR(bruto);
  return /^55\d{10,11}$/.test(n) ? n : null;
}

/** Primeira mensagem ao cliente: quem fala, de onde e sobre o que. */
export function saudacao(p: { cliente: string | null; autor: string; role: string; provedor: string; numeroOs: string | null }): string {
  const primeiroNome = p.cliente?.trim().split(/\s+/)[0];
  const ola = primeiroNome ? `Olá, ${primeiroNome[0]!.toUpperCase()}${primeiroNome.slice(1).toLowerCase()}!` : "Olá!";
  const quem = p.role === UserRole.TECNICO ? `${p.autor}, técnico da ${p.provedor}` : `${p.autor}, da ${p.provedor}`;
  const sobre = p.numeroOs ? ` Falo sobre a sua ordem de serviço nº ${p.numeroOs}.` : "";
  return `${ola} Aqui é ${quem}.${sobre}`;
}

/**
 * Botao "Conversar com o cliente" da OS: abre (ou retoma) a conversa pelo canal
 * do provedor e devolve o id dela aqui, para a tela abrir o chat.
 *
 * Se a conversa ja esta aberta e com quem clicou, so devolve (nao repete a
 * saudacao). Senao manda a saudacao — ou o `texto` que a pessoa escreveu.
 */
export async function iniciarComClienteDaOs(user: JwtPayload, osId: string, texto?: string): Promise<{ conversaId: string }> {
  const os = await prisma.ordemServico.findUnique({
    where: { id: osId },
    select: {
      id: true,
      provedorId: true,
      tecnicoId: true,
      apoios: { select: { id: true } },
      telefone: true,
      clienteNome: true,
      numero: true,
      sgpOsId: true,
      provedor: { select: { nome: true } },
    },
  });
  if (!os) throw new HttpError(404, "OS não encontrada");
  if (!podeAcessarOs(user, os)) throw new HttpError(403, "Você não tem acesso a esta OS");

  return iniciarComCliente(
    user,
    {
      provedorId: os.provedorId,
      provedorNome: os.provedor.nome,
      telefone: os.telefone,
      clienteNome: os.clienteNome,
      numeroOs: os.numero ?? os.sgpOsId,
      ordemServicoId: os.id,
      semCelular: "Esta OS não tem um celular válido do cliente. Ligue ou atualize o cadastro no SGP.",
    },
    texto,
  );
}

/** Para quem falar: o cliente, o provedor dele e (se houver) a OS que motivou a conversa. */
export interface AlvoConversaCliente {
  provedorId: string;
  provedorNome: string;
  telefone: string | null;
  clienteNome: string | null;
  numeroOs: string | null;
  /** Nulo quando a conversa nasce fora de uma OS (ex.: o vendedor no pre-cadastro). */
  ordemServicoId: string | null;
  /** O erro quando o telefone nao serve — cada origem explica de um jeito. */
  semCelular: string;
}

/**
 * Abre (ou retoma) a conversa com o cliente pelo canal do provedor no AtendAI.
 * Quem chama ja conferiu que o usuario pode falar com esse cliente.
 */
export async function iniciarComCliente(user: JwtPayload, alvo: AlvoConversaCliente, texto?: string): Promise<{ conversaId: string }> {
  const telefone = telefoneDaOs(alvo.telefone);
  if (!telefone) throw new HttpError(409, alvo.semCelular);

  const cfg = await prisma.atendaiConfig.findUnique({
    where: { provedorId: alvo.provedorId },
    select: { ativo: true, canalClientesId: true },
  });
  if (!cfg?.ativo || !cfg.canalClientesId) {
    throw new HttpError(
      409,
      `A ${alvo.provedorNome} ainda não definiu por qual WhatsApp saem as conversas com o cliente. Um supervisor escolhe em Provedores > ${alvo.provedorNome} > AtendAI.`,
    );
  }
  const canalId = cfg.canalClientesId;

  const chave = { telefone_canal_canalRef: { telefone, canal: CanalWhatsapp.ATENDAI, canalRef: canalId } };
  const existente = await prisma.conversaCliente.findUnique({ where: chave, select: { id: true, arquivada: true, agenteId: true } });
  if (existente && !existente.arquivada && existente.agenteId === user.sub && !texto?.trim()) {
    if (alvo.ordemServicoId) await prisma.conversaCliente.update({ where: { id: existente.id }, data: { ordemServicoId: alvo.ordemServicoId } });
    return { conversaId: existente.id };
  }

  const cred = await credencialOuErro(alvo.provedorId);
  const autor = await prisma.usuario.findUniqueOrThrow({ where: { id: user.sub }, select: { id: true, nome: true, role: true } });
  const corpo =
    texto?.trim() ||
    saudacao({ cliente: alvo.clienteNome, autor: autor.nome, role: autor.role, provedor: alvo.provedorNome, numeroOs: alvo.numeroOs });

  let r: { conversaId: string; envio: "texto" | "template"; mensagemId: string };
  try {
    await cadastrarNoAtendai(cred, alvo.provedorId, autor);
    r = await chamar(cred, "POST", "/atendimentos", {
      canalId,
      telefone,
      nomeContato: alvo.clienteNome ?? undefined,
      deIdExterno: autor.id,
      texto: corpo,
      // So usado pela Meta fora da janela de 24h; o Evolution manda o texto.
      template: { nome: MODELO_PRIMEIRO_CONTATO, parametros: [alvo.clienteNome?.trim().split(/\s+/)[0] || "cliente", autor.nome] },
    });
  } catch (e) {
    erroDoAtendai(e);
  }

  const agora = new Date();
  const conversa = await prisma.conversaCliente.upsert({
    where: chave,
    create: {
      telefone,
      canal: CanalWhatsapp.ATENDAI,
      canalRef: canalId,
      nomeContato: alvo.clienteNome,
      agenteId: user.sub,
      iniciadaPorId: user.sub,
      origem: OrigemConversaCliente.SAIDA,
      ultimaMensagemEm: agora,
      atendaiConversaId: r.conversaId,
      provedorId: alvo.provedorId,
      ordemServicoId: alvo.ordemServicoId,
    },
    // Quem clicou passa a atender (abriu pela OS em que trabalha). `iniciadaPorId`
    // fica: quem abriu antes continua vendo a conversa dele.
    // Sem OS (pre-cadastro), a ligacao que a conversa ja tinha fica.
    update: {
      arquivada: false,
      agenteId: user.sub,
      atendaiConversaId: r.conversaId,
      ...(alvo.ordemServicoId ? { ordemServicoId: alvo.ordemServicoId } : {}),
      ultimaMensagemEm: agora,
    },
    select: { id: true },
  });
  const mensagem = await prisma.mensagemCliente.create({
    data: {
      conversaId: conversa.id,
      canal: CanalWhatsapp.ATENDAI,
      direcao: MensagemClienteDirecao.SAIDA,
      autorId: user.sub,
      tipo: MensagemClienteTipo.TEXTO,
      corpo: r.envio === "template" ? `[Modelo ${MODELO_PRIMEIRO_CONTATO}] ${corpo}` : corpo,
      templateNome: r.envio === "template" ? MODELO_PRIMEIRO_CONTATO : null,
      waMessageId: r.mensagemId,
    },
    select: { id: true },
  });

  const em = agora.toISOString();
  emitParaTodos({ tipo: "cliente-chat-conversa", conversaId: conversa.id, em });
  emitParaTodos({ tipo: "cliente-chat-mensagem", conversaId: conversa.id, mensagemId: mensagem.id, autorId: user.sub, em });
  return { conversaId: conversa.id };
}

/** Resposta escrita aqui numa conversa `atendai`: vai para a conversa de la, em nome de quem escreveu. */
export async function enviarPeloAtendai(
  conversa: Pick<ConversaCliente, "provedorId" | "atendaiConversaId">,
  autorId: string,
  corpo: string,
): Promise<{ ok: boolean; waMessageId?: string; erro?: string }> {
  if (!conversa.provedorId || !conversa.atendaiConversaId) return { ok: false, erro: "Conversa sem vínculo com o AtendAI" };
  try {
    const cred = await credencialOuErro(conversa.provedorId);
    const autor = await prisma.usuario.findUniqueOrThrow({ where: { id: autorId }, select: { id: true, nome: true, role: true } });
    await cadastrarNoAtendai(cred, conversa.provedorId, autor);
    const r = await chamar<{ id: string }>(cred, "POST", `/atendimentos/${encodeURIComponent(conversa.atendaiConversaId)}/mensagens`, {
      texto: corpo,
      deIdExterno: autor.id,
    });
    return { ok: true, waMessageId: r.id };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao enviar pelo AtendAI" };
  }
}

/**
 * "Encerrar": a IA de la volta a atender o cliente. Se o AtendAI recusar porque
 * a conversa ja nao esta com o ISPhub (404/409), encerra so aqui.
 */
export async function encerrarNoAtendai(conversa: Pick<ConversaCliente, "provedorId" | "atendaiConversaId">): Promise<void> {
  if (!conversa.provedorId || !conversa.atendaiConversaId) return;
  try {
    const cred = await credencialOuErro(conversa.provedorId);
    await chamar(cred, "POST", `/atendimentos/${encodeURIComponent(conversa.atendaiConversaId)}/encerrar`);
  } catch (e) {
    if (e instanceof AtendaiIndisponivel && (e.status === 404 || e.status === 409)) return;
    erroDoAtendai(e);
  }
}

/**
 * OS concluida encerra a conversa aberta por ela: a CláudIA volta a atender o
 * cliente sem depender de alguem lembrar do "Encerrar". Roda logo depois de o
 * tecnico concluir e ao fim de cada sync (OS encerrada no SGP).
 *
 * Desvincula a OS ao encerrar: se o tecnico voltar a escrever, a conversa
 * reabre e nao e encerrada de novo no proximo sync. AtendAI fora do ar deixa a
 * conversa aberta e vinculada — a proxima rodada tenta de novo.
 */
export async function encerrarConversasDeOsConcluidas(filtro: { ordemServicoId?: string; provedorId?: string }): Promise<number> {
  const abertas = await prisma.conversaCliente.findMany({
    where: {
      canal: CanalWhatsapp.ATENDAI,
      arquivada: false,
      ordemServicoId: filtro.ordemServicoId ?? { not: null },
      ...(filtro.provedorId ? { provedorId: filtro.provedorId } : {}),
    },
    select: { id: true, provedorId: true, atendaiConversaId: true, ordemServicoId: true },
  });
  if (abertas.length === 0) return 0;
  const concluidas = await prisma.ordemServico.findMany({
    where: { id: { in: abertas.map((c) => c.ordemServicoId!) }, status: OsStatus.CONCLUIDA },
    select: { id: true },
  });
  const ids = new Set(concluidas.map((o) => o.id));

  let encerradas = 0;
  for (const c of abertas) {
    if (!ids.has(c.ordemServicoId!)) continue;
    try {
      await encerrarNoAtendai(c);
      await prisma.conversaCliente.update({ where: { id: c.id }, data: { arquivada: true, ordemServicoId: null } });
      emitParaTodos({ tipo: "cliente-chat-conversa", conversaId: c.id, em: new Date().toISOString() });
      encerradas++;
    } catch (e) {
      console.warn(`[cliente-atendai] OS concluida, mas a conversa ${c.id} nao encerrou:`, e instanceof Error ? e.message : e);
    }
  }
  return encerradas;
}

/** `cliente_nova_mensagem` do AtendAI (corpo ja com a assinatura conferida). */
export interface AvisoCliente {
  conversaId?: string;
  contato?: { nome?: string | null } | null;
  mensagem?: { id?: string; corpo?: string | null; anexo?: boolean } | null;
}

/**
 * Resposta do cliente: entra na conversa daqui uma vez so e avisa quem atende.
 * Conversa encerrada aqui ou desconhecida e ignorada — o cliente voltou a falar
 * com a IA, nao com o tecnico.
 */
export async function receberDoCliente(provedorId: string, aviso: AvisoCliente): Promise<"ok" | "ignorado"> {
  const atendaiConversaId = aviso.conversaId;
  const msgId = aviso.mensagem?.id;
  if (!atendaiConversaId || !msgId) return "ignorado";
  const conversa = await prisma.conversaCliente.findUnique({ where: { atendaiConversaId } });
  if (!conversa || conversa.provedorId !== provedorId || conversa.arquivada) return "ignorado";

  const texto = aviso.mensagem?.corpo?.trim() || null;
  const corpo = aviso.mensagem?.anexo ? [texto, "[O cliente enviou um arquivo — veja no AtendAI]"].filter(Boolean).join("\n") : texto;
  if (!corpo) return "ignorado";

  const existe = await prisma.mensagemCliente.findUnique({
    where: { canal_waMessageId: { canal: CanalWhatsapp.ATENDAI, waMessageId: msgId } },
    select: { id: true },
  });
  if (existe) return "ignorado";

  const mensagem = await prisma.mensagemCliente.create({
    data: {
      conversaId: conversa.id,
      canal: CanalWhatsapp.ATENDAI,
      direcao: MensagemClienteDirecao.ENTRADA,
      tipo: MensagemClienteTipo.TEXTO,
      corpo,
      waMessageId: msgId,
    },
    select: { id: true },
  });
  await prisma.conversaCliente.update({ where: { id: conversa.id }, data: { ultimaMensagemEm: new Date() } });
  emitParaTodos({ tipo: "cliente-chat-mensagem", conversaId: conversa.id, mensagemId: mensagem.id, em: new Date().toISOString() });

  const destino = conversa.agenteId ?? conversa.iniciadaPorId;
  if (destino) {
    dispararPush([destino], {
      titulo: conversa.nomeContato?.trim() || conversa.telefone,
      corpo: corpo.length > 120 ? `${corpo.slice(0, 120)}…` : corpo,
      dados: { tela: "chat-clientes", conversaId: conversa.id },
    });
  }

  // Se a mensagem for resposta de confirmacao ou reagendamento de visita
  void tratarRespostaConfirmacao(provedorId, conversa.telefone, corpo).catch(() => {});

  return "ok";
}

/**
 * Formata o texto de aviso ao cliente quando o técnico inicia o deslocamento.
 */
export function formatarMensagemTecnicoACaminho(input: {
  clienteNome: string;
  tecnicoNome: string;
  provedorNome: string;
  numeroOs: string;
  veiculoInfo?: { rotulo: string; placa: string } | null;
  tempoEstimado?: { faixaMinutos: string; distanciaTexto: string } | null;
  fotoUrl?: string | null;
}): string {
  const primeiroNome = input.clienteNome?.trim().split(/\s+/)[0] || "Cliente";
  const primeiroNomeTecnico = input.tecnicoNome?.trim().split(/\s+/)[0] || "nosso técnico";

  const partes = [
    `Olá, ${primeiroNome}!`,
    `O técnico *${primeiroNomeTecnico}* da *${input.provedorNome}* acabou de iniciar o deslocamento e está a caminho do seu endereço para o atendimento da OS nº *${input.numeroOs}*.`,
  ];

  if (input.tempoEstimado) {
    partes.push(`⏱️ *Previsão de chegada:* cerca de ${input.tempoEstimado.faixaMinutos} (~${input.tempoEstimado.distanciaTexto} de distância).`);
  }

  if (input.veiculoInfo?.placa) {
    partes.push(`🚗 *Veículo oficial:* ${input.veiculoInfo.rotulo} (Placa ${input.veiculoInfo.placa})`);
  }

  partes.push("Por favor, fique atento ao portão/interfone para receber nossa equipe.");

  if (input.fotoUrl) {
    partes.push(`🛡️ *Identificação de segurança:* Por sua segurança, confira a foto do técnico no crachá digital antes de abrir o portão:\n${input.fotoUrl}`);
  }

  return partes.join("\n\n");
}

/**
 * Notifica o cliente automaticamente pelo WhatsApp oficial do provedor (Meta/NetGo)
 * quando o técnico clica em "Marcar a caminho" no PWA/APK.
 * Calcula a rota em tempo real com trânsito (TomTom Routing API) entre o veículo e a casa do cliente.
 */
export async function avisarClienteACaminho(
  ordemServicoId: string,
  autorId: string,
  geo?: { lat?: number | null; lng?: number | null } | null,
): Promise<boolean> {
  try {
    const os = await prisma.ordemServico.findUnique({
      where: { id: ordemServicoId },
      include: { provedor: { select: { nome: true } } },
    });
    if (!os || !os.telefone) return false;

    const autor = await prisma.usuario.findUnique({
      where: { id: autorId },
      select: { id: true, nome: true, role: true, temFoto: true, fotoVersao: true },
    });
    if (!autor) return false;

    // Busca veiculo ativo do tecnico se houver e seu rastreador GPS
    const ocupacao = await prisma.ocupacaoVeiculo.findFirst({
      where: { usuarioId: autor.id, fimEm: null },
      include: {
        veiculo: {
          select: {
            id: true,
            apelido: true,
            placa: true,
            vinculos: {
              where: { fimEm: null },
              select: { rastreadorId: true },
              take: 1,
            },
          },
        },
      },
    });

    const veiculoInfo = ocupacao?.veiculo
      ? { rotulo: ocupacao.veiculo.apelido || "Viatura de serviço", placa: ocupacao.veiculo.placa }
      : null;

    // Determina a posição de origem (GPS do carro via rastreador ou GPS enviado pelo app)
    let posOrigem: { lat: number; lng: number } | null = null;
    if (geo && typeof geo.lat === "number" && typeof geo.lng === "number") {
      posOrigem = { lat: geo.lat, lng: geo.lng };
    } else if (ocupacao?.veiculo?.vinculos?.[0]?.rastreadorId) {
      const rastreadorId = ocupacao.veiculo.vinculos[0].rastreadorId;
      const ultimaPos = await prisma.posicaoRastreador.findFirst({
        where: { rastreadorId },
        orderBy: { registradoEm: "desc" },
        select: { lat: true, lng: true, registradoEm: true },
      });
      // Aceita posições registradas nas últimas 4 horas
      if (ultimaPos && Date.now() - ultimaPos.registradoEm.getTime() < 4 * 60 * 60 * 1000) {
        posOrigem = { lat: ultimaPos.lat, lng: ultimaPos.lng };
      }
    }

    const posDestino = os.lat && os.lng ? { lat: os.lat, lng: os.lng } : null;
    const rota = await calcularRotaComTransito(posOrigem, posDestino);

    const texto = formatarMensagemTecnicoACaminho({
      clienteNome: os.clienteNome || "Cliente",
      tecnicoNome: autor.nome,
      provedorNome: os.provedor.nome,
      numeroOs: os.numero ?? os.sgpOsId,
      veiculoInfo,
      tempoEstimado: rota
        ? {
            faixaMinutos: rota.faixaMinutos,
            distanciaTexto: rota.distanciaTexto,
          }
        : null,
      fotoUrl: null, // Opção 1 escolhida: sem links
    });

    await enviarMensagemParaCliente({
      provedorId: os.provedorId,
      telefone: os.telefone,
      ordemServicoId: os.id,
      texto,
    });

    return true;
  } catch (err) {
    console.warn("[avisarClienteACaminho] Aviso ao cliente não enviado:", err instanceof Error ? err.message : err);
    return false;
  }
}

