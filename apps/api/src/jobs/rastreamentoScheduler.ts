import cron from "node-cron";
import { emitParaTodos } from "../services/realtimeHub.js";
import { coletarDeUmaConfig, configsVencidas } from "../services/rastreamentoService.js";

/**
 * Coleta as posicoes dos rastreadores.
 *
 * A PlataformaTK nao tem webhook — e polling, e este job e o unico lugar que
 * fala com o fornecedor. Tudo o mais no sistema le `PosicaoRastreador`, que e o
 * cache de verdade: um cache em memoria daria duas verdades assim que houvesse
 * uma segunda replica, e o mapa e exatamente a tela em que duas verdades
 * aparecem lado a lado.
 *
 * Tique de 1 minuto, mas cada credencial so e consultada quando o
 * `intervaloPollingSegundos` dela vence — mesmo criterio do syncScheduler.
 *
 * Duas replicas rodando isto e desperdicio, NAO corrupcao: a chave natural do
 * ponto e (rastreador, carimbo do aparelho), e `skipDuplicates` descarta a
 * segunda insercao.
 */
let tickEmAndamento = false;

async function tick() {
  // Coleta lenta (rede) num intervalo curto: sem a guarda, os tiques se
  // empilham e a frota e consultada varias vezes ao mesmo tempo.
  if (tickEmAndamento) return;
  tickEmAndamento = true;
  try {
    const configs = await configsVencidas(new Date());
    if (configs.length === 0) return;

    let gravadosNoTique = 0;
    for (const c of configs) {
      try {
        const r = await coletarDeUmaConfig(c);
        gravadosNoTique += r.gravados;
        /*
         * Registra o RESULTADO, e nao so a falha — como o syncScheduler ja faz.
         * Sem isto, "nao apareceu erro" era a unica evidencia disponivel, e ela
         * nao distingue "coletou tudo" de "nao coletou nada": um rastreador sem
         * veiculo vinculado, por exemplo, some do laco em silencio.
         */
        console.log(
          `[rastreamento] ${r.consultados} rastreador(es) consultado(s), ${r.gravados} posicao(oes) nova(s)` +
            (r.cadastrosAtualizados > 0 ? `, ${r.cadastrosAtualizados} cadastro(s) do fornecedor` : "") +
            (r.dicionarioAtualizado ? ", dicionario de sensores atualizado" : "") +
            (r.statusOk ? "" : " — status do fornecedor indisponivel"),
        );
        if (r.erro) console.warn(`[rastreamento] config ${c.id}: ${r.erro}`);
      } catch (err) {
        // Uma credencial ruim nao pode calar as outras.
        console.error(`[rastreamento] falha na config ${c.id}:`, err);
      }
    }

    /*
     * UM evento por tique, sem `veiculoId` e SEM COORDENADA — sinal de
     * invalidacao, nao carga de dados.
     *
     * `emitParaTodos` alcanca todo mundo conectado, inclusive tecnico e
     * provedor, que nao podem ver frota. Mandando so "refaz tua busca", cada
     * cliente refaz pelo PROPRIO endpoint, ja escopado, e nada vaza. Carga de
     * tamanho constante tambem, independente do tamanho da frota.
     */
    if (gravadosNoTique > 0) {
      emitParaTodos({ tipo: "posicao-veiculo", em: new Date().toISOString() });
    }
  } catch (err) {
    console.error("[rastreamento] falha no tick:", err);
  } finally {
    tickEmAndamento = false;
  }
}

/** Vitest dispara o tique direto; o cron fica mockado. */
export const __tickParaTeste = tick;

export function startRastreamentoScheduler() {
  cron.schedule("* * * * *", () => {
    void tick();
  });
  console.log("[rastreamento] ativo (verificacao a cada minuto, intervalo por credencial)");
}
