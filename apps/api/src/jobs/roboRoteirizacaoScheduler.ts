import cron from "node-cron";
import { comTravaExclusiva } from "../lib/prisma.js";
import { otimizarTodasRotasDoDia } from "../services/logisticaService.js";

/**
 * Robô de Roteirização Automática:
 * Executa todos os dias às 06:30 e 07:30 BR (09:30 e 10:30 UTC), antes do início dos atendimentos.
 * Otimiza e salva a ordem de paradas no menor percurso para todos os técnicos com OS marcadas.
 * Custo: R$ 0,00 (algoritmo TSP 2-opt determinístico local).
 */
export function startRoboRoteirizacaoScheduler() {
  cron.schedule("30 9,10 * * *", () => {
    void comTravaExclusiva(
      "robo-roteirizacao",
      async () => {
        console.log("[robo-roteirizacao] iniciando otimização matinal de rotas do dia...");
        const res = await otimizarTodasRotasDoDia();
        console.log(
          `[robo-roteirizacao] concluído: ${res.tecnicosOtimizados} técnicos, ${res.totalParadas} paradas, -${res.kmTotalEconomizado} km poupados`,
        );
      },
      5 * 60_000,
    ).catch((e) => console.error("[robo-roteirizacao] falha na execução:", e));
  });
  console.log("[robo-roteirizacao-scheduler] ativo (roteirizacao automatica as 06:30 e 07:30 BR)");
}
