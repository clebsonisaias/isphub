import cron from "node-cron";
import { comTravaExclusiva } from "../lib/prisma.js";
import { avisarManutencoes } from "../services/manutencaoService.js";

/** Todo dia as 07:00 BR (10:00 UTC): manutencao vencida ou vencendo toca o sino dos gestores. */
export function startManutencaoAlertaScheduler() {
  cron.schedule("0 10 * * *", () => {
    void comTravaExclusiva("manutencao-alerta", avisarManutencoes, 10 * 60_000).catch((e) =>
      console.error("[manutencao-alerta] falha:", e),
    );
  });
  console.log("[manutencao-alerta-scheduler] ativo (manutencao preventiva, diario as 07:00 BR)");
}
