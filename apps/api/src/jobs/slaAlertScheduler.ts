import cron from "node-cron";
import { OS_STATUS_ABERTOS, UserRole } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { selecionarOsParaAlertar, type OsParaAvaliarSla } from "../services/slaAlertService.js";
import { OS_INTERNA_WHERE } from "../services/equipeService.js";

/**
 * Job separado do sync (roda a cada 5 min, nao a cada 1 min como o sync):
 * varre OS abertas ainda nao notificadas, calcula o SLA efetivo (mesmo
 * fallback tipo -> categoria usado em fila.ts/dashboard.ts) e, pras que
 * estao com o semaforo vermelho, notifica o tecnico atribuido (se houver) e
 * todo admin/gestor ativo. `slaNotificadoEm` trava a OS pra nao alertar de
 * novo em ticks seguintes — e um alerta unico por OS, nao um sistema de
 * re-alerta.
 */
let tickEmAndamento = false;

async function tick() {
  if (tickEmAndamento) return;
  tickEmAndamento = true;
  try {
    const ordens = await prisma.ordemServico.findMany({
      where: {
        status: { in: OS_STATUS_ABERTOS },
        slaNotificadoEm: null,
        // Retirada/cancelamento e executada por outra equipe: alertar a
        // equipe ISPhub sobre um prazo que nao esta na mao dela so gera
        // ruido — e o alerta e unico por OS (slaNotificadoEm trava), entao
        // ruido aqui seria ruido permanente.
        AND: [OS_INTERNA_WHERE],
      },
      select: {
        id: true,
        tecnicoId: true,
        clienteNome: true,
        sgpOsId: true,
        dataAgendamento: true,
        dataCadastro: true,
        criadoEm: true,
        tipoOs: { select: { slaHoras: true, categoria: { select: { slaHorasPadrao: true } } } },
      },
    });
    if (ordens.length === 0) return;

    const candidatas: OsParaAvaliarSla[] = ordens.map((os) => ({
      id: os.id,
      tecnicoId: os.tecnicoId,
      dataAgendamento: os.dataAgendamento,
      dataCadastro: os.dataCadastro,
      criadoEm: os.criadoEm,
      slaHoras: os.tipoOs?.slaHoras ?? os.tipoOs?.categoria?.slaHorasPadrao ?? null,
    }));
    const estouradas = selecionarOsParaAlertar(candidatas, new Date());
    if (estouradas.length === 0) return;

    const gestores = await prisma.usuario.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.GESTOR] }, ativo: true },
      select: { id: true },
    });
    const gestorIds = gestores.map((g) => g.id);

    for (const os of estouradas) {
      const original = ordens.find((o) => o.id === os.id)!;
      const mensagem = `SLA estourado: ${original.clienteNome ?? `OS #${original.sgpOsId}`}`;
      const destinatarios = new Set(gestorIds);
      if (os.tecnicoId) destinatarios.add(os.tecnicoId);

      await prisma.$transaction([
        prisma.ordemServico.update({ where: { id: os.id }, data: { slaNotificadoEm: new Date() } }),
        prisma.notificacao.createMany({
          data: [...destinatarios].map((usuarioId) => ({
            usuarioId,
            tipo: "sla_estourado",
            mensagem,
            ordemServicoId: os.id,
          })),
        }),
      ]);
    }
  } catch (err) {
    console.error("[sla-alert-scheduler] falha no tick:", err);
  } finally {
    tickEmAndamento = false;
  }
}

export function startSlaAlertScheduler() {
  cron.schedule("*/5 * * * *", () => {
    void tick();
  });
  console.log("[sla-alert-scheduler] ativo (verifica SLA estourado a cada 5 min)");
}
