import cron from "node-cron";
import { sincronizarTodosTecnicosSgp } from "../services/tecnicosSgpService.js";
import { sincronizarColaboradoresDeTodos } from "../services/ponteChatAtendaiService.js";

/**
 * Lista de tecnicos do SGP de cada provedor: todo dia as 06:10 (BR; o cron e
 * UTC) e uma vez 2 min depois de subir, pra um deploy ja trazer a lista sem
 * esperar o dia seguinte. So atualiza a lista — vincular e decisao do admin.
 */
/** A lista do SGP e, depois, a equipe no chat do AtendAI (tecnico novo passa a aparecer para as atendentes). */
async function rodar() {
  await sincronizarTodosTecnicosSgp().catch((e) => console.error("[tecnicos-sgp]", e));
  await sincronizarColaboradoresDeTodos().catch((e) => console.error("[chat-atendai]", e));
}

export function startTecnicosSgpScheduler() {
  cron.schedule("10 9 * * *", () => void rodar());
  setTimeout(() => void rodar(), 120_000);
  console.log("[tecnicos-sgp] ativo (todo dia 06:10 e 2 min apos subir)");
}
