/**
 * Onde o dia do tecnico comeca e termina.
 *
 * Mora em `shared`, e nao no servidor, porque as DUAS pontas precisam da mesma
 * resposta: a API corta o resumo de "meu dia" por aqui, e o app monta a agenda
 * mandando `de`/`ate` pra /fila. Duas definicoes de "quando o dia vira" nao
 * discordariam em teste nenhum — discordariam so no fim da tarde, em producao,
 * e como um numero que nao bate com a lista logo abaixo dele.
 */

/**
 * Fuso do Brasil, -03:00 fixo — o pais aboliu horario de verao em 2019. Mesma
 * decisao ja documentada em `connectors/sgp.ts` (FUSO_SGP) e em `routes/hora.ts`.
 */
const OFFSET_BR_MIN = -180;

/**
 * Comeco (inclusivo) e fim (exclusivo) do dia CIVIL brasileiro que contem
 * `agora`, ambos em UTC.
 *
 * O detalhe que faz isto existir: o servidor roda sem `TZ`, ou seja, em UTC.
 * Zerar as horas com `setHours(0,0,0,0)` daria meia-noite UTC — 21h de ONTEM em
 * Natal. Toda OS agendada entre 21h e meia-noite cairia no dia seguinte, e o
 * tecnico veria a agenda de amanha comecar no meio da noite de hoje.
 */
export function diaBrasileiro(agora: Date): { inicio: Date; fim: Date } {
  // Desloca pro horario local BR, zera o relogio la, e volta pra UTC.
  const local = new Date(agora.getTime() + OFFSET_BR_MIN * 60_000);
  const meiaNoiteLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0, 0);
  const inicio = new Date(meiaNoiteLocal - OFFSET_BR_MIN * 60_000);
  return { inicio, fim: new Date(inicio.getTime() + 24 * 60 * 60_000) };
}

/**
 * O mesmo dia, no formato que a rota `/fila` aceita (`z.string().datetime()`).
 *
 * `ate` é o ULTIMO instante do dia, não a meia-noite seguinte: `fila.ts` usa
 * `lte` (inclusivo), então mandar o `fim` exclusivo puxaria a primeira OS de
 * amanhã pra agenda de hoje.
 */
export function filtroDoDia(agora: Date): { de: string; ate: string } {
  const { inicio, fim } = diaBrasileiro(agora);
  return { de: inicio.toISOString(), ate: new Date(fim.getTime() - 1).toISOString() };
}
