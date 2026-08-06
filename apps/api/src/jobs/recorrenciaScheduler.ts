import cron from "node-cron";
import { gerarTodas, HORIZONTE_MESES } from "../services/recorrenciaService.js";

/**
 * Empurra a janela de geracao das recorrencias.
 *
 * Roda DIARIO, nao mensal: a janela e movel (ver HORIZONTE_MESES), e um job
 * mensal deixaria a proxima ocorrencia aparecer de repente no dia 1 em vez de
 * ir entrando conforme o tempo passa. Diario tambem significa que uma falha de
 * um dia se conserta sozinha no dia seguinte, sem ninguem perceber.
 *
 * Rodar duas vezes NAO duplica: a geracao e idempotente pela unicidade
 * (recorrenciaId, vencimento) no banco. Isso e o que permite o job ser bobo.
 */
let tickEmAndamento = false;

async function tick() {
  if (tickEmAndamento) return;
  tickEmAndamento = true;
  try {
    const r = await gerarTodas();
    // So fala quando fez alguma coisa — um log diario de "0 criados" vira
    // ruido e esconde o dia em que algo aconteceu.
    if (r.criados > 0) {
      console.log(`[recorrencia] ${r.criados} lancamento(s) gerado(s) de ${r.recorrencias} recorrencia(s) ativa(s)`);
    }
  } catch (err) {
    console.error("[recorrencia] falha no tick:", err instanceof Error ? err.message : err);
  } finally {
    tickEmAndamento = false;
  }
}

export function startRecorrenciaScheduler() {
  // 03:10 — fora do horario de uso, e depois da virada do dia pra janela ja
  // contar o dia novo.
  cron.schedule("10 3 * * *", () => void tick());
  // E uma vez no boot: um container que subiu depois de dias parado nao pode
  // esperar ate as 3h pra materializar o que faltou.
  void tick();
  console.log(`[recorrencia-scheduler] ativo (horizonte de ${HORIZONTE_MESES} meses, tick diario as 03:10)`);
}
