import cron from "node-cron";
import { UserRole, dataDoDia, diaBrHoje, type TurnoAgenda } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";

/**
 * ESCALADO E SEM JORNADA — avisa o gestor as 08:30 e as 13:30 (hora BR) sobre
 * quem estava escalado no turno e ainda nao iniciou a jornada. So avisa:
 * marcar falta e gesto humano (ver `marcarAusencia`), porque 20 min de atraso
 * nao sao uma falta.
 *
 * Trava por coluna (`avisosSemJornada` acumula o turno ja avisado), no mesmo
 * padrao de `notificadoEm` dos outros jobs.
 */
export async function avisarEscaladosSemJornada(turno: TurnoAgenda, agora = new Date()): Promise<number> {
  const hoje = diaBrHoje(agora);
  const inicioDoDia = new Date(dataDoDia(hoje).getTime() + 3 * 3_600_000); // 00:00 BR

  const escalas = await prisma.escalaJornada.findMany({
    where: {
      dia: dataDoDia(hoje),
      turnos: { has: turno },
      ausenteEm: null,
      NOT: { avisosSemJornada: { has: turno } },
      usuario: { ativo: true, role: "tecnico", jornadas: { none: { inicioEm: { gte: inicioDoDia } } } },
    },
    select: { id: true, usuario: { select: { nome: true, nomeExibicao: true } } },
  });
  if (escalas.length === 0) return 0;

  const gestores = await prisma.usuario.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.GESTOR] }, ativo: true },
    select: { id: true },
  });
  const rotuloTurno = turno === "manha" ? "manhã" : "tarde";
  let avisados = 0;
  for (const e of escalas) {
    const nome = e.usuario.nomeExibicao || e.usuario.nome;
    await prisma.$transaction([
      prisma.escalaJornada.update({ where: { id: e.id }, data: { avisosSemJornada: { push: turno } } }),
      prisma.notificacao.createMany({
        data: gestores.map((g) => ({
          usuarioId: g.id,
          tipo: "escalado_sem_jornada",
          mensagem: `${nome} está escalado(a) para a ${rotuloTurno} e ainda não iniciou a jornada.`,
        })),
      }),
    ]);
    avisados += 1;
  }
  return avisados;
}

export function startEscalaAlertaScheduler() {
  // 08:30 e 13:30 em Natal = 11:30 e 16:30 UTC; seg–sab.
  cron.schedule("30 11 * * 1-6", () => void avisarEscaladosSemJornada("manha").catch((e) => console.error("[escala-alerta] manha:", e)));
  cron.schedule("30 16 * * 1-5", () => void avisarEscaladosSemJornada("tarde").catch((e) => console.error("[escala-alerta] tarde:", e)));
  console.log("[escala-alerta-scheduler] ativo (escalado sem jornada as 08:30 e 13:30 BR)");
}
