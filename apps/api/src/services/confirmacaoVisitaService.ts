import {
  CanalWhatsapp,
  MensagemClienteDirecao,
  MensagemClienteTipo,
  OrigemConversaCliente,
  TurnoAgenda,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { normalizarTelefoneBR, type BotaoWhatsapp } from "../connectors/whatsappMeta.js";
import * as whatsappMeta from "../connectors/whatsappMeta.js";
import * as whatsappEvolution from "../connectors/whatsappEvolution.js";
import * as canaisWhatsappService from "./canaisWhatsappService.js";
import * as agendaService from "./agendaService.js";
import { iniciarComClienteDaOs } from "./clienteAtendaiService.js";
import { emitParaTodos } from "./realtimeHub.js";
import type { JwtPayload } from "./authService.js";

const DIAS_SEMANA_ABREV = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_SEMANA_EXTENSO = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

export function formatarRotuloSlot(diaIso: string, turno: TurnoAgenda): string {
  const [ano, mes, dia] = diaIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano!, mes! - 1, dia!, 12, 0, 0));
  const diaSemana = DIAS_SEMANA_ABREV[data.getUTCDay()] ?? "Dia";
  const turnoRotulo = turno === "manha" ? "Manhã" : "Tarde";
  const diaStr = String(dia).padStart(2, "0");
  const mesStr = String(mes).padStart(2, "0");
  return `${diaSemana} ${diaStr}/${mesStr} · ${turnoRotulo}`;
}

export function formatarDiaTurnoLongo(diaIso: string, turno: TurnoAgenda): string {
  const [ano, mes, dia] = diaIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano!, mes! - 1, dia!, 12, 0, 0));
  const diaSemana = DIAS_SEMANA_EXTENSO[data.getUTCDay()] ?? "";
  const descTurno = turno === "manha" ? "manhã (08h às 12h)" : "tarde (13h às 18h)";
  const diaStr = String(dia).padStart(2, "0");
  const mesStr = String(mes).padStart(2, "0");
  return `${diaSemana}, ${diaStr}/${mesStr}/${ano} no turno da ${descTurno}`;
}

export type RespostaInterpretada =
  | "confirmar"
  | "reagendar"
  | { tipo: "slot"; dia: string; turno: TurnoAgenda }
  | { tipo: "indice"; indice: number }
  | "outro";

/**
 * Interpreta o texto enviado pelo cliente em resposta ao lembrete de visita.
 * Suporta botões interativos da Meta Cloud API, seleção por letras A, B, C ou números 1, 2, 3.
 */
export function interpretarRespostaCliente(texto: string, solicitouReagendamento?: boolean): RespostaInterpretada {
  const limpo = texto.trim();
  const norm = limpo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // 1. Botão interativo específico de slot ou regex de slot (ex: slot_2026-11-06_manha)
  const slotMatch = norm.match(/^(?:slot|reagendar)[_-](\d{4}-\d{2}-\d{2})[_-](manha|tarde)$/i);
  if (slotMatch && slotMatch[1] && slotMatch[2]) {
    return {
      tipo: "slot",
      dia: slotMatch[1],
      turno: slotMatch[2] as TurnoAgenda,
    };
  }

  // 2. Botão interativo de confirmação ou reagendamento
  if (norm === "btn_confirmar_visita") return "confirmar";
  if (norm === "btn_reagendar_visita") return "reagendar";

  // 3. Escolha por letra (A, B, C)
  if (
    norm === "a" ||
    norm === "opcao a" ||
    norm === "letra a" ||
    norm.startsWith("a)") ||
    norm.startsWith("a -") ||
    norm.startsWith("a-")
  ) {
    return { tipo: "indice", indice: 0 };
  }
  if (
    norm === "b" ||
    norm === "opcao b" ||
    norm === "letra b" ||
    norm.startsWith("b)") ||
    norm.startsWith("b -") ||
    norm.startsWith("b-")
  ) {
    return { tipo: "indice", indice: 1 };
  }
  if (
    norm === "c" ||
    norm === "opcao c" ||
    norm === "letra c" ||
    norm.startsWith("c)") ||
    norm.startsWith("c -") ||
    norm.startsWith("c-")
  ) {
    return { tipo: "indice", indice: 2 };
  }

  // 4. Se o agendamento já solicitou reagendamento e o usuário respondeu com o número da opção (1, 2, 3)
  if (solicitouReagendamento) {
    if (norm === "1" || norm.startsWith("1 -") || norm.startsWith("1-") || norm.startsWith("1)") || norm === "opcao 1") {
      return { tipo: "indice", indice: 0 };
    }
    if (norm === "2" || norm.startsWith("2 -") || norm.startsWith("2-") || norm.startsWith("2)") || norm === "opcao 2") {
      return { tipo: "indice", indice: 1 };
    }
    if (norm === "3" || norm.startsWith("3 -") || norm.startsWith("3-") || norm.startsWith("3)") || norm === "opcao 3") {
      return { tipo: "indice", indice: 2 };
    }
  }

  // 5. Reagendamento / negativa avaliado primeiro para evitar falsos positivos como "nao estarei"
  if (
    norm === "2" ||
    norm.startsWith("2 -") ||
    norm.startsWith("2-") ||
    norm === "nao" ||
    norm.startsWith("nao,") ||
    norm.startsWith("nao ") ||
    norm.includes("reagendar") ||
    norm.includes("remarcar") ||
    norm.includes("nao estarei") ||
    norm.includes("trocar") ||
    norm.includes("cancelar")
  ) {
    return "reagendar";
  }

  // 6. Confirmação
  if (
    norm === "1" ||
    norm.startsWith("1 -") ||
    norm.startsWith("1-") ||
    norm === "sim" ||
    norm.startsWith("sim,") ||
    norm.startsWith("sim ") ||
    norm.includes("confirmo") ||
    norm.includes("confirmado") ||
    norm.includes("estarei") ||
    norm.includes("pode vir") ||
    norm === "ok" ||
    norm === "positivo"
  ) {
    return "confirmar";
  }

  return "outro";
}

/**
 * Monta o texto de mensagem enviado ao WhatsApp do cliente (fallback texto puro).
 */
export function montarMensagemConfirmacao(
  clienteNome: string,
  provedorNome: string,
  diaFormatado: string,
  turno: string,
  numeroOs: string,
): string {
  const primeiroNome = clienteNome.trim().split(/\s+/)[0] || "Cliente";
  const descTurno = turno === "manha" ? "manhã (08h às 12h)" : "tarde (13h às 18h)";

  return [
    `Olá, ${primeiroNome}!`,
    `Sua visita técnica com a ${provedorNome} está agendada para *${diaFormatado}* no turno da *${descTurno}* (OS nº ${numeroOs}).`,
    "",
    "Haverá alguém maior de 18 anos no local para receber nossa equipe?",
    "👉 Responda *1 para Confirmar*",
    "👉 Responda *2 para Reagendar*",
  ].join("\n");
}

/**
 * Registra a mensagem enviada nos registros do chat do sistema para manter o histórico visível.
 */
async function registrarMensagemSaidaMeta(
  telefone: string,
  corpo: string,
  waMessageId?: string,
  provedorId?: string,
  ordemServicoId?: string | null,
) {
  const agora = new Date();
  const telNorm = normalizarTelefoneBR(telefone) ?? telefone.replace(/\D/g, "");
  const chave = { telefone_canal_canalRef: { telefone: telNorm, canal: CanalWhatsapp.META, canalRef: "" } };

  const conversa = await prisma.conversaCliente.upsert({
    where: chave,
    create: {
      telefone: telNorm,
      canal: CanalWhatsapp.META,
      origem: OrigemConversaCliente.SAIDA,
      ultimaMensagemEm: agora,
      provedorId,
      ordemServicoId: ordemServicoId ?? null,
    },
    update: {
      arquivada: false,
      ultimaMensagemEm: agora,
      ...(provedorId ? { provedorId } : {}),
      ...(ordemServicoId ? { ordemServicoId } : {}),
    },
  });

  const msg = await prisma.mensagemCliente.create({
    data: {
      conversaId: conversa.id,
      canal: CanalWhatsapp.META,
      direcao: MensagemClienteDirecao.SAIDA,
      tipo: MensagemClienteTipo.TEXTO,
      corpo,
      waMessageId: waMessageId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });

  emitParaTodos({ tipo: "cliente-chat-conversa", conversaId: conversa.id, em: agora.toISOString() });
  emitParaTodos({ tipo: "cliente-chat-mensagem", conversaId: conversa.id, mensagemId: msg.id, em: agora.toISOString() });
}

/**
 * Envia mensagem para o WhatsApp do cliente priorizando a API oficial da Meta (com botões interativos),
 * com fallback inteligente para Evolution API e AtendAI.
 */
export async function enviarMensagemParaCliente(args: {
  provedorId: string;
  telefone: string;
  ordemServicoId?: string | null;
  texto: string;
  botoes?: BotaoWhatsapp[];
}): Promise<void> {
  // 1. Prioridade: Meta WhatsApp Cloud API Oficial
  const metaConfig = await canaisWhatsappService.getConfig(CanalWhatsapp.META);
  if (metaConfig && metaConfig.tipo === "meta") {
    let res: { ok: boolean; waMessageId?: string; erro?: string };
    if (args.botoes && args.botoes.length > 0) {
      res = await whatsappMeta.enviarBotoes(metaConfig, args.telefone, args.texto, args.botoes);
    } else {
      res = await whatsappMeta.enviarTexto(metaConfig, args.telefone, args.texto);
    }
    if (res.ok) {
      await registrarMensagemSaidaMeta(
        args.telefone,
        args.botoes && args.botoes.length > 0
          ? `${args.texto}\n\n[Botões: ${args.botoes.map((b) => b.titulo).join(" | ")}]`
          : args.texto,
        res.waMessageId,
        args.provedorId,
        args.ordemServicoId,
      ).catch((e) => console.warn("[confirmacao-visita] Falha ao registrar msg no chat:", e));
      return;
    }
    console.warn("[confirmacao-visita] Envio via Meta falhou, tentando fallback:", res.erro);
  }

  // 2. Fallback: Evolution API
  const evolutionConfig = await canaisWhatsappService.getConfig(CanalWhatsapp.EVOLUTION);
  if (evolutionConfig && evolutionConfig.tipo === "evolution") {
    const res = await whatsappEvolution.enviarTexto(evolutionConfig, args.telefone, args.texto);
    if (res.ok) return;
    console.warn("[confirmacao-visita] Envio via Evolution falhou:", res.erro);
  }

  // 3. Fallback: AtendAI
  if (args.ordemServicoId) {
    const userSistema: JwtPayload = {
      sub: "sistema-confirmacao",
      email: "sistema@isphub.net.br",
      role: "admin" as any,
      provedorId: args.provedorId,
    };
    await iniciarComClienteDaOs(userSistema, args.ordemServicoId, args.texto);
  }
}

/**
 * Dispara lembretes de visita para todos os agendamentos de uma data específica
 * que ainda não foram confirmados.
 */
export async function dispararConfirmacoesDoDia(dataAlvo: Date): Promise<{ enviados: number; falhas: number }> {
  const diaIso = dataAlvo.toISOString().slice(0, 10);
  const dataInicio = new Date(`${diaIso}T00:00:00.000Z`);

  const agendamentos = await prisma.agendamento.findMany({
    where: {
      dia: dataInicio,
      status: "marcado",
      confirmadoEm: null,
      solicitouReagendamento: false,
      lembreteEnviadoEm: null,
      ordemServico: {
        isNot: null,
      },
    },
    include: {
      provedor: { select: { id: true, nome: true } },
      ordemServico: {
        select: {
          id: true,
          numero: true,
          sgpOsId: true,
          clienteNome: true,
          telefone: true,
        },
      },
    },
  });

  let enviados = 0;
  let falhas = 0;

  for (const ag of agendamentos) {
    const os = ag.ordemServico;
    if (!os || !os.telefone) continue;

    const diaFormatado = dataAlvo.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
    const primeiroNome = (os.clienteNome || "Cliente").trim().split(/\s+/)[0] || "Cliente";
    const descTurno = ag.turno === "manha" ? "manhã (08h às 12h)" : "tarde (13h às 18h)";
    const numOs = os.numero || os.sgpOsId;

    try {
      const metaConfig = await canaisWhatsappService.getConfig(CanalWhatsapp.META);
      if (metaConfig && metaConfig.tipo === "meta") {
        const corpo = [
          `Olá, ${primeiroNome}!`,
          `Sua visita técnica com a ${ag.provedor.nome} está agendada para *${diaFormatado}* no turno da *${descTurno}* (OS nº ${numOs}).`,
          "",
          "Haverá alguém maior de 18 anos no local para receber nossa equipe?",
        ].join("\n");

        const botoes: BotaoWhatsapp[] = [
          { id: "btn_confirmar_visita", titulo: "Confirmar Visita" },
          { id: "btn_reagendar_visita", titulo: "Reagendar" },
        ];

        await enviarMensagemParaCliente({
          provedorId: ag.provedorId,
          telefone: os.telefone,
          ordemServicoId: os.id,
          texto: corpo,
          botoes,
        });
      } else {
        const texto = montarMensagemConfirmacao(
          os.clienteNome || "Cliente",
          ag.provedor.nome,
          diaFormatado,
          ag.turno,
          numOs,
        );

        await enviarMensagemParaCliente({
          provedorId: ag.provedorId,
          telefone: os.telefone,
          ordemServicoId: os.id,
          texto,
        });
      }

      await prisma.agendamento.update({
        where: { id: ag.id },
        data: { lembreteEnviadoEm: new Date() },
      });

      enviados++;
    } catch (err) {
      console.warn(`[confirmacao-visita] Falha ao enviar para OS ${os.sgpOsId}:`, err);
      falhas++;
    }
  }

  return { enviados, falhas };
}

/**
 * Compara o telefone cadastrado na OS com o telefone que respondeu no webhook.
 */
export function matchTelefone(telCadastrado: string | null | undefined, telRecebido: string): boolean {
  if (!telCadastrado || !telRecebido) return false;

  const rNorm = normalizarTelefoneBR(telRecebido);
  const cNorm = normalizarTelefoneBR(telCadastrado);

  // 1. Match exato pós-normalização (ambos com DDI + DDD + 9 dígitos)
  if (rNorm === cNorm) return true;

  // 2. Match dos 11 dígitos nacionais (DDD + 9 dígitos)
  const rNacional = rNorm.startsWith("55") && rNorm.length >= 12 ? rNorm.slice(2) : rNorm;
  const cNacional = cNorm.startsWith("55") && cNorm.length >= 12 ? cNorm.slice(2) : cNorm;
  if (rNacional.length >= 10 && rNacional === cNacional) return true;

  // 3. Caso o cadastro tenha DDD + 8 dígitos (celular legado sem o 9º dígito): mesmo DDD e mesmos 8 dígitos finais
  if (cNacional.length === 10 && rNacional.length === 11) {
    const cDdd = cNacional.slice(0, 2);
    const rDdd = rNacional.slice(0, 2);
    if (cDdd === rDdd && cNacional.slice(2) === rNacional.slice(3)) {
      return true;
    }
  }

  // 4. Caso o cadastro contenha apenas o número local (sem DDD no cadastro do SGP: 8 ou 9 dígitos)
  const cDigitos = telCadastrado.replace(/\D/g, "");
  if (cDigitos.length === 8 || cDigitos.length === 9) {
    const rLocal = rNacional.slice(-cDigitos.length);
    if (cDigitos === rLocal) return true;
  }

  return false;
}

/**
 * Trata mensagem recebida do cliente no webhook e atualiza o agendamento correspondente.
 * Se o cliente desejar reagendar, consulta vagas reais no banco e envia opções interativas.
 * Se escolher uma vaga, executa o reagendamento com lock transacional e confirmação imediata.
 */
export async function tratarRespostaConfirmacao(
  provedorId: string | undefined,
  telefone: string,
  mensagemTexto: string,
): Promise<"confirmado" | "reagendamento" | "reagendado" | "ignorado"> {
  const telNorm = normalizarTelefoneBR(telefone) ?? telefone.replace(/\D/g, "");

  // Localiza os agendamentos marcados de hoje em diante para encontrar a OS do telefone
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const candidatos = await prisma.agendamento.findMany({
    where: {
      ...(provedorId ? { provedorId } : {}),
      status: "marcado",
      dia: { gte: hoje },
      ordemServico: {
        isNot: null,
      },
    },
    orderBy: { dia: "asc" },
    include: {
      provedor: { select: { id: true, nome: true } },
      ordemServico: { select: { id: true, sgpOsId: true, clienteNome: true, telefone: true } },
    },
  });

  const agendamento = candidatos.find((ag) => matchTelefone(ag.ordemServico?.telefone, telNorm));

  if (!agendamento) return "ignorado";

  const decisao = interpretarRespostaCliente(mensagemTexto, agendamento.solicitouReagendamento);
  if (decisao === "outro") return "ignorado";

  if (decisao === "confirmar") {
    await prisma.agendamento.update({
      where: { id: agendamento.id },
      data: {
        confirmadoEm: new Date(),
        solicitouReagendamento: false,
      },
    });

    await prisma.agendamentoEvento.create({
      data: {
        provedorId: agendamento.provedorId,
        sgpOsId: agendamento.sgpOsId,
        agendamentoId: agendamento.id,
        tipo: "confirmado",
        origem: "cliente",
        dia: agendamento.dia,
        turno: agendamento.turno,
        autor: "Cliente via WhatsApp",
      },
    });

    emitParaTodos({
      tipo: "os-alterada",
      em: new Date().toISOString(),
    });

    await enviarMensagemParaCliente({
      provedorId: agendamento.provedorId,
      telefone: agendamento.ordemServico?.telefone ?? telNorm,
      ordemServicoId: agendamento.ordemServicoId,
      texto: "Perfeito! Sua visita está confirmada. Nossa equipe estará no seu endereço no turno combinado. Obrigado!",
    }).catch(() => {});

    return "confirmado";
  }

  if (decisao === "reagendar") {
    await prisma.agendamento.update({
      where: { id: agendamento.id },
      data: {
        solicitouReagendamento: true,
      },
    });

    await prisma.agendamentoEvento.create({
      data: {
        provedorId: agendamento.provedorId,
        sgpOsId: agendamento.sgpOsId,
        agendamentoId: agendamento.id,
        tipo: "reagendamento_solicitado",
        origem: "cliente",
        dia: agendamento.dia,
        turno: agendamento.turno,
        autor: "Cliente via WhatsApp",
      },
    });

    emitParaTodos({
      tipo: "os-alterada",
      em: new Date().toISOString(),
    });

    // Buscar as próximas 3 vagas reais no banco
    const vagas = await agendaService.proximasVagasDoBanco({
      regiao: agendamento.regiao,
      quantas: 3,
    });

    if (vagas.length === 0) {
      await enviarMensagemParaCliente({
        provedorId: agendamento.provedorId,
        telefone: agendamento.ordemServico?.telefone ?? telNorm,
        ordemServicoId: agendamento.ordemServicoId,
        texto: "Tudo bem! Registramos que você precisa de outra data. Nossa equipe de atendimento entrará em contato em breve para combinar o melhor dia para você.",
      }).catch(() => {});
      return "reagendamento";
    }

    const metaConfig = await canaisWhatsappService.getConfig(CanalWhatsapp.META);
    if (metaConfig && metaConfig.tipo === "meta") {
      const botoes: BotaoWhatsapp[] = vagas.slice(0, 3).map((v) => ({
        id: `slot_${v.dia}_${v.turno}`,
        titulo: formatarRotuloSlot(v.dia, v.turno),
      }));

      await enviarMensagemParaCliente({
        provedorId: agendamento.provedorId,
        telefone: agendamento.ordemServico?.telefone ?? telNorm,
        ordemServicoId: agendamento.ordemServicoId,
        texto: "Sem problemas! Para quando deseja reagendar sua visita técnica?\nEscolha uma das opções abaixo:",
        botoes,
      }).catch(() => {});
    } else {
      const letras = ["A", "B", "C"];
      const linhasOpcoes = vagas.slice(0, 3).map((v, i) => {
        const descTurno = v.turno === "manha" ? "Manhã (08h às 12h)" : "Tarde (13h às 18h)";
        return `${letras[i]}) ${formatarRotuloSlot(v.dia, v.turno)} (${descTurno})`;
      });

      const texto = [
        "Sem problemas! Temos as seguintes opções disponíveis para reagendar sua visita técnica:",
        "",
        ...linhasOpcoes,
        "",
        "👉 Responda com a letra (A, B ou C) da opção desejada.",
      ].join("\n");

      await enviarMensagemParaCliente({
        provedorId: agendamento.provedorId,
        telefone: agendamento.ordemServico?.telefone ?? telNorm,
        ordemServicoId: agendamento.ordemServicoId,
        texto,
      }).catch(() => {});
    }

    return "reagendamento";
  }

  // Tratamento de escolha de slot
  let targetDia: string | null = null;
  let targetTurno: TurnoAgenda | null = null;

  if (typeof decisao === "object" && decisao.tipo === "slot") {
    targetDia = decisao.dia;
    targetTurno = decisao.turno;
  } else if (typeof decisao === "object" && decisao.tipo === "indice") {
    const vagas = await agendaService.proximasVagasDoBanco({
      regiao: agendamento.regiao,
      quantas: 3,
    });
    const vagaEscolhida = vagas[decisao.indice];
    if (vagaEscolhida) {
      targetDia = vagaEscolhida.dia;
      targetTurno = vagaEscolhida.turno;
    }
  }

  if (targetDia && targetTurno) {
    try {
      const salvo = await agendaService.marcar({
        provedorId: agendamento.provedorId,
        sgpOsId: agendamento.sgpOsId,
        dia: targetDia,
        turno: targetTurno,
        regiao: agendamento.regiao,
        origem: "cliente_whatsapp",
        marcadoPor: "Cliente via WhatsApp",
        observacao: "Reagendado automaticamente pelo cliente via WhatsApp",
      });

      await prisma.agendamento.update({
        where: { id: salvo.id },
        data: {
          confirmadoEm: new Date(),
          solicitouReagendamento: false,
        },
      });

      emitParaTodos({
        tipo: "os-alterada",
        em: new Date().toISOString(),
      });

      const dataExtenso = formatarDiaTurnoLongo(targetDia, targetTurno);
      await enviarMensagemParaCliente({
        provedorId: agendamento.provedorId,
        telefone: agendamento.ordemServico?.telefone ?? telNorm,
        ordemServicoId: agendamento.ordemServicoId,
        texto: `Visita técnica reagendada com sucesso para ${dataExtenso}! Nossa equipe estará no seu endereço no horário marcado. Obrigado!`,
      }).catch(() => {});

      return "reagendado";
    } catch (err) {
      console.warn("[confirmacao-visita] Erro ao reagendar vaga:", err);
      await enviarMensagemParaCliente({
        provedorId: agendamento.provedorId,
        telefone: agendamento.ordemServico?.telefone ?? telNorm,
        ordemServicoId: agendamento.ordemServicoId,
        texto: "Ops, essa vaga acabou de ser preenchida ou não está mais disponível. Nossa equipe de atendimento entrará em contato para agendar um novo horário com você.",
      }).catch(() => {});
      return "reagendamento";
    }
  }

  return "ignorado";
}
