import cron from "node-cron";
import { sincronizarTodosTecnicosSgp } from "../services/tecnicosSgpService.js";

/**
 * Lista de tecnicos do SGP de cada provedor: todo dia as 06:10 (BR; o cron e
 * UTC) e uma vez 2 min depois de subir, pra um deploy ja trazer a lista sem
 * esperar o dia seguinte. So atualiza a lista — vincular e decisao do admin.
 */
export function startTecnicosSgpScheduler() {
  cron.schedule("10 9 * * *", () => void sincronizarTodosTecnicosSgp().catch((e) => console.error("[tecnicos-sgp]", e)));
  setTimeout(() => void sincronizarTodosTecnicosSgp().catch((e) => console.error("[tecnicos-sgp]", e)), 120_000);
  console.log("[tecnicos-sgp] ativo (todo dia 06:10 e 2 min apos subir)");
}
