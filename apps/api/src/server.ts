import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { startSyncScheduler } from "./jobs/syncScheduler.js";
import { startSlaAlertScheduler } from "./jobs/slaAlertScheduler.js";
import { startOsNovaAlertScheduler } from "./jobs/osNovaAlertScheduler.js";
import { startRastreamentoScheduler } from "./jobs/rastreamentoScheduler.js";
import { startFrotaAlertaScheduler } from "./jobs/frotaAlertaScheduler.js";
import { startRecorrenciaScheduler } from "./jobs/recorrenciaScheduler.js";
import { startDeslocamentoScheduler } from "./jobs/deslocamentoScheduler.js";
import { startEscalaAlertaScheduler } from "./jobs/escalaAlertaScheduler.js";
import { startAuditoriaVisitaScheduler } from "./jobs/auditoriaVisitaScheduler.js";
import { startManutencaoAlertaScheduler } from "./jobs/manutencaoAlertaScheduler.js";
import { startAutoAgendaScheduler } from "./jobs/autoAgendaScheduler.js";
import { fecharTodasConexoes } from "./services/realtimeHub.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[isphub-api] ouvindo na porta ${env.PORT}`);
  startSyncScheduler();
  startSlaAlertScheduler();
  startOsNovaAlertScheduler();
  startRecorrenciaScheduler();
  startRastreamentoScheduler();
  startFrotaAlertaScheduler();
  startDeslocamentoScheduler();
  startEscalaAlertaScheduler();
  startAuditoriaVisitaScheduler();
  startManutencaoAlertaScheduler();
  startAutoAgendaScheduler();
});

/**
 * Desligamento gracioso. Sem isto, todo redeploy do Coolify matava requests em
 * voo no meio — inclusive write-backs pro SGP do provedor, que podem gravar de
 * um lado e nao do outro — e derrubava as conexoes SSE sem aviso.
 *
 * Ordem: para de aceitar conexao nova -> fecha os SSE (senao o server nunca
 * "esvazia": conexao SSE e eterna por natureza) -> espera o que esta em voo ->
 * fecha o banco. Prazo de 10s pra nao travar o deploy se algo pendurar.
 */
const TIMEOUT_DESLIGAMENTO_MS = 10_000;
let desligando = false;

async function desligar(sinal: string) {
  if (desligando) return;
  desligando = true;
  console.log(`[isphub-api] ${sinal} recebido — desligando...`);

  const prazo = setTimeout(() => {
    console.error("[isphub-api] desligamento demorou demais, encerrando a forca");
    process.exit(1);
  }, TIMEOUT_DESLIGAMENTO_MS);
  prazo.unref();

  fecharTodasConexoes();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect().catch(() => {});

  console.log("[isphub-api] desligado com seguranca");
  process.exit(0);
}

process.on("SIGTERM", () => void desligar("SIGTERM"));
process.on("SIGINT", () => void desligar("SIGINT"));
