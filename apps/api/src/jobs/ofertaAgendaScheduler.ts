import cron from "node-cron";
import { rodarOferta } from "../services/ofertaAgendaService.js";

/**
 * Robo de agendamento: a cada 5 min oferece datas por WhatsApp as OS
 * agendaveis sem visita. So age para provedor com a chave ligada
 * (`AtendaiConfig.ofertaAgendaAtiva`) e entre 07h e 20h de Brasilia.
 */
export async function tickOfertaAgenda() {
  const r = await rodarOferta();
  if (r.erro) console.error("[oferta-agenda-scheduler] rodada interrompida:", r.erro);
  if (r.enviadas || r.falhas || r.semRetorno || r.agendadas) {
    console.log(`[oferta-agenda-scheduler] enviadas=${r.enviadas} falhas=${r.falhas} semRetorno=${r.semRetorno} agendadas=${r.agendadas}`);
  }
}

export function startOfertaAgendaScheduler() {
  cron.schedule("*/5 * * * *", () => {
    void tickOfertaAgenda();
  });
  console.log("[oferta-agenda-scheduler] ativo (a cada 5 min; só age com o robô ligado no provedor)");
}
