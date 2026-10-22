import cron from "node-cron";
import { UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { rodarAuto } from "../services/autoAgendaService.js";

/**
 * Agendador automatico: a cada 10 min marca instalacao e reparo sozinho.
 * Desligado por padrao (`AgendaConfig.autoAgendaAtiva`) — o tick so olha a
 * chave. A retirada nunca sai por aqui, so por lote aprovado.
 *
 * Erro nao some em log: avisa admin/gestor UMA vez por sequencia de falhas
 * (`avisouFalha` trava ate a proxima rodada sem erro).
 */
let avisouFalha = false;

async function avisarFalha(erro: string) {
  const gestores = await prisma.usuario.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.GESTOR] }, ativo: true },
    select: { id: true },
  });
  await prisma.notificacao.createMany({
    data: gestores.map((g) => ({
      usuarioId: g.id,
      tipo: "agenda_auto_falhou",
      mensagem: `O agendador automático falhou: ${erro.slice(0, 200)}`,
    })),
  });
}

export async function tickAutoAgenda() {
  const r = await rodarAuto();
  if (r.erro) {
    console.error("[auto-agenda-scheduler] rodada falhou:", r.erro);
    if (!avisouFalha) {
      avisouFalha = true;
      await avisarFalha(r.erro).catch((e) => console.error("[auto-agenda-scheduler] aviso falhou:", e));
    }
    return;
  }
  avisouFalha = false;
  if (r.marcadas > 0 || r.recusadas > 0) {
    console.log(`[auto-agenda-scheduler] marcadas=${r.marcadas} recusadas=${r.recusadas}`);
  }
}

export function startAutoAgendaScheduler() {
  cron.schedule("*/10 * * * *", () => {
    void tickAutoAgenda();
  });
  console.log("[auto-agenda-scheduler] ativo (a cada 10 min; só age com a chave ligada na Agenda)");
}
