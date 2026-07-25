import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { syncProvedor } from "../services/syncService.js";

/**
 * Scheduler de polling multi-provedor. Roda um "tick" a cada minuto (via
 * node-cron) e, para cada integracao SGP ativa, decide se ja e hora de
 * sincronizar de novo com base em `intervaloPollingSegundos` e na
 * `ultimaSyncEm` daquele provedor especifico. Isso da suporte a intervalos
 * distintos por provedor usando um unico job cron como "coracao" do sistema,
 * em vez de um cron por provedor (mais simples de operar e observar).
 */
let tickEmAndamento = false;

async function tick() {
  if (tickEmAndamento) return; // evita sobreposicao se um ciclo demorar mais que 1 minuto
  tickEmAndamento = true;
  try {
    const configs = await prisma.erpConfig.findMany({ where: { ativo: true } });
    const agora = Date.now();

    for (const config of configs) {
      const ultimaMs = config.ultimaSyncEm?.getTime() ?? 0;
      const proximaMs = ultimaMs + config.intervaloPollingSegundos * 1000;
      if (agora < proximaMs) continue;

      try {
        await syncProvedor(config.provedorId);
      } catch (err) {
        console.error(`[sync-scheduler] falha ao sincronizar provedor ${config.provedorId}:`, err);
      }
    }
  } finally {
    tickEmAndamento = false;
  }
}

export function startSyncScheduler() {
  cron.schedule("* * * * *", () => {
    void tick();
  });
  console.log("[sync-scheduler] ativo (verificacao a cada minuto, intervalo por provedor configuravel)");
}
