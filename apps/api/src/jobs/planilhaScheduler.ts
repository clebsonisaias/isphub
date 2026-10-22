import cron from "node-cron";
import { rodarPlanilha } from "../services/planilhaSyncService.js";

/**
 * Robo planilha -> ISPhub a cada 15 min. Sem as envs do robo, cada tick e um
 * retorno imediato. O resumo da ultima rodada sai em `GET /agenda/planilha`.
 */
export function startPlanilhaScheduler() {
  cron.schedule("*/15 * * * *", () => {
    void rodarPlanilha().then((r) => {
      if (!r?.ativo) return;
      if (r.erro) console.error("[planilha-sync] erro:", r.erro);
      else if (r.marcadas.length || r.desmarcadas.length || r.conflitos.length || r.trava) {
        console.log(
          `[planilha-sync] marcadas=${r.marcadas.length} desmarcadas=${r.desmarcadas.length} conflitos=${r.conflitos.length} recusadas=${r.recusadas.length}${r.trava ? " TRAVA" : ""}`,
        );
      }
    });
  });
  console.log("[planilha-sync] ativo (a cada 15 min; só age com GOOGLE_SA_JSON, PLANILHA_SYNC_FILE_ID e PLANILHA_SYNC_PROVEDOR)");
}
