import cron from "node-cron";
import { dispararConfirmacoesDoDia } from "../services/confirmacaoVisitaService.js";

/**
 * Agendador automático de confirmações de visita pelo WhatsApp:
 * - Às 18:00 todo dia: confirma visitas de amanhã (D+1).
 * - Às 07:15 todo dia: confirma visitas de hoje (D0) que ainda não foram enviadas.
 */
export function startConfirmacaoVisitaScheduler() {
  // 18:00 todos os dias: visitas do dia seguinte
  cron.schedule("0 18 * * *", () => {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    void dispararConfirmacoesDoDia(amanha).then((res) => {
      console.log(`[confirmacao-visita] Véspera: ${res.enviados} enviadas, ${res.falhas} falhas.`);
    });
  });

  // 07:15 todos os dias: visitas do próprio dia
  cron.schedule("15 7 * * *", () => {
    const hoje = new Date();
    void dispararConfirmacoesDoDia(hoje).then((res) => {
      console.log(`[confirmacao-visita] Manhã: ${res.enviados} enviadas, ${res.falhas} falhas.`);
    });
  });

  console.log("[confirmacao-visita] ativo (disparos diários às 18:00 e 07:15)");
}
