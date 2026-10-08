import cron from "node-cron";
import { comTravaExclusiva } from "../lib/prisma.js";
import { calcularDeslocamentoOs, pendentesDeCalculo } from "../services/deslocamentoService.js";

/**
 * Calcula o km ate cada OS concluida, em lotes, fora do caminho de quem
 * fecha a OS: medir pode exigir uma ida ao fornecedor de rastreamento, e isso
 * nao pode atrasar o tecnico. Advisory lock por chave: duas instancias (deploy
 * do Coolify) nao medem a mesma OS duas vezes.
 */
async function tick() {
  await comTravaExclusiva("deslocamento-os", async () => {
    const ids = await pendentesDeCalculo(50);
    for (const id of ids) {
      try {
        await calcularDeslocamentoOs(id);
      } catch (err) {
        console.error(`[deslocamento-scheduler] falha na OS ${id}:`, err);
      }
    }
  }, 9 * 60_000);
}

export function startDeslocamentoScheduler() {
  cron.schedule("*/10 * * * *", () => {
    void tick();
  });
  console.log("[deslocamento-scheduler] ativo (km por OS a cada 10 min)");
}
