import cron from "node-cron";
import { comTravaExclusiva } from "../lib/prisma.js";
import { auditarOs, notificarAusentes, pendentesDeAuditoria } from "../services/auditoriaVisitaService.js";

/** Audita presenca das OS concluidas e avisa as ausentes. A cada 30 min, com advisory lock. */
async function tick() {
  await comTravaExclusiva("auditoria-visita", async () => {
    for (const id of await pendentesDeAuditoria(6, 50)) {
      try {
        await auditarOs(id);
      } catch (err) {
        console.error(`[auditoria-visita] falha na OS ${id}:`, err);
      }
    }
    await notificarAusentes();
  }, 25 * 60_000);
}

export function startAuditoriaVisitaScheduler() {
  cron.schedule("*/30 * * * *", () => {
    void tick();
  });
  console.log("[auditoria-visita-scheduler] ativo (presenca da viatura nas OS concluidas, a cada 30 min)");
}
