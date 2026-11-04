import { TurnoAgenda } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { normalizarTelefoneBR } from "../connectors/whatsappMeta.js";
import { iniciarComClienteDaOs } from "./clienteAtendaiService.js";
import { emitParaTodos } from "./realtimeHub.js";
import type { JwtPayload } from "./authService.js";

/**
 * Interpreta o texto enviado pelo cliente em resposta ao lembrete de visita.
 */
export function interpretarRespostaCliente(texto: string): "confirmar" | "reagendar" | "outro" {
  const norm = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Reagendamento / negativa avaliado primeiro para evitar falsos positivos como "nao estarei"
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
 * Monta o texto de mensagem enviado ao WhatsApp do cliente.
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
    const texto = montarMensagemConfirmacao(
      os.clienteNome || "Cliente",
      ag.provedor.nome,
      diaFormatado,
      ag.turno,
      os.numero || os.sgpOsId,
    );

    try {
      // Dispara usando a identidade de sistema (robô)
      const userSistema: JwtPayload = {
        sub: "sistema-confirmacao",
        email: "sistema@isphub.net.br",
        role: "admin" as any,
        provedorId: ag.provedorId,
      };

      await iniciarComClienteDaOs(userSistema, os.id, texto);

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
 * Trata mensagem recebida do cliente no webhook e atualiza o agendamento correspondente.
 */
export async function tratarRespostaConfirmacao(
  provedorId: string,
  telefone: string,
  mensagemTexto: string,
): Promise<"confirmado" | "reagendamento" | "ignorado"> {
  const decisao = interpretarRespostaCliente(mensagemTexto);
  if (decisao === "outro") return "ignorado";

  const telNorm = normalizarTelefoneBR(telefone) ?? telefone.replace(/\D/g, "");

  // Localiza a OS mais recente desse telefone no provedor que tenha agendamento futuro ou de hoje
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const agendamento = await prisma.agendamento.findFirst({
    where: {
      provedorId,
      status: "marcado",
      dia: { gte: hoje },
      ordemServico: {
        OR: [
          { telefone: { contains: telNorm.slice(-8) } },
          { telefone: { contains: telNorm } },
        ],
      },
    },
    orderBy: { dia: "asc" },
    include: {
      provedor: { select: { id: true, nome: true } },
      ordemServico: { select: { id: true, sgpOsId: true, clienteNome: true } },
    },
  });

  if (!agendamento) return "ignorado";

  const userSistema: JwtPayload = {
    sub: "sistema-confirmacao",
    email: "sistema@isphub.net.br",
    role: "admin" as any,
    provedorId,
  };

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
        provedorId,
        sgpOsId: agendamento.sgpOsId,
        agendamentoId: agendamento.id,
        tipo: "confirmado",
        origem: "cliente",
        dia: agendamento.dia,
        turno: agendamento.turno,
        autor: "Cliente via WhatsApp",
      },
    });

    emitParaTodos("agendamento:confirmado", {
      id: agendamento.id,
      sgpOsId: agendamento.sgpOsId,
      dia: agendamento.dia,
      turno: agendamento.turno,
    });

    if (agendamento.ordemServicoId) {
      await iniciarComClienteDaOs(
        userSistema,
        agendamento.ordemServicoId,
        "Perfeito! Sua visita está confirmada. Nossa equipe estará no seu endereço no turno combinado. Obrigado!",
      ).catch(() => {});
    }

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
        provedorId,
        sgpOsId: agendamento.sgpOsId,
        agendamentoId: agendamento.id,
        tipo: "reagendamento_solicitado",
        origem: "cliente",
        dia: agendamento.dia,
        turno: agendamento.turno,
        autor: "Cliente via WhatsApp",
      },
    });

    emitParaTodos("agendamento:reagendamento_solicitado", {
      id: agendamento.id,
      sgpOsId: agendamento.sgpOsId,
      dia: agendamento.dia,
      turno: agendamento.turno,
    });

    if (agendamento.ordemServicoId) {
      await iniciarComClienteDaOs(
        userSistema,
        agendamento.ordemServicoId,
        "Tudo bem! Registramos que você precisa de outra data. Nossa equipe de atendimento entrará em contato em breve para combinar o melhor dia para você.",
      ).catch(() => {});
    }

    return "reagendamento";
  }

  return "ignorado";
}
