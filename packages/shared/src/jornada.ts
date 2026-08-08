/**
 * Jornada do tecnico — MARCADOR OPERACIONAL, nao ponto eletronico.
 *
 * Responde "estou em servico desde as X, ha Y horas". NAO vale como registro de
 * jornada da CLT: a Portaria 671 exigiria registro inviolavel, espelho de ponto
 * e comprovante por marcacao, e nada disso esta aqui. Se um dia precisar valer,
 * e outro modelo — nao um campo a mais neste.
 *
 * As funcoes puras moram em `shared` porque o app e o painel web formatam o
 * mesmo numero: se cada um calculasse a duracao do seu jeito, o tecnico e o
 * gestor veriam tempos diferentes para a mesma jornada.
 */

/** Uma jornada aberta (ou a que acabou de fechar), como a API devolve. */
export interface Jornada {
  id: string;
  inicioEm: string;
  /** Nulo = ainda aberta. */
  fimEm: string | null;
  latInicio: number | null;
  lngInicio: number | null;
  latFim: number | null;
  lngFim: number | null;
}

/**
 * Resposta das rotas de jornada.
 *
 * `agoraServidor` viaja JUNTO de proposito. O cronometro e
 * `agora - inicioEm`, e `inicioEm` foi carimbado pelo relogio do servidor —
 * medir contra o relogio do APARELHO faria um celular desacertado mentir na
 * cara do tecnico ("tempo trabalhado" e justamente o numero que ele confere).
 *
 * Poderia vir do `/hora`, mas nao deve: aquele endpoint busca hora externa
 * (timeapi.io) com cache de 60s — um relogio DIFERENTE do que carimbou o
 * inicio, e comparar dois relogios introduz deriva. Aqui os dois carimbos
 * saem da mesma fonte, na mesma resposta, sem requisicao extra.
 */
export interface JornadaResposta {
  jornada: Jornada | null;
  agoraServidor: string;
}

/** Um tecnico em servico agora — a visao do gestor. */
export interface TecnicoEmJornada {
  usuarioId: string;
  nome: string;
  nomeExibicao: string | null;
  temFoto: boolean;
  fotoVersao: number;
  inicioEm: string;
}

/**
 * A partir de quando uma jornada aberta merece alerta na tela.
 *
 * 12h. Voce escolheu NAO fechar sozinho, entao este aviso e a unica defesa
 * contra o classico "esqueci de encerrar ontem" virar um cronometro de 27h que
 * ninguem questiona. Nao bloqueia nada — so para de deixar o numero passar por
 * normal.
 */
export const JORNADA_LONGA_MS = 12 * 60 * 60_000;

/** Quanto tempo a jornada durou (ou dura), decomposto pra exibicao. */
export function duracaoJornada(inicioEm: string, ate: Date): { horas: number; minutos: number; ms: number } {
  const ms = Math.max(0, ate.getTime() - Date.parse(inicioEm));
  const totalMin = Math.floor(ms / 60_000);
  return { horas: Math.floor(totalMin / 60), minutos: totalMin % 60, ms };
}

/**
 * "05h58" — o formato da referencia.
 *
 * Minutos com zero a esquerda SEMPRE: sem isso "5h7" e "5h07" alternam a
 * largura do texto, e num mostrador que atualiza sozinho isso vira tremor.
 * (O `tabular-nums` do lado do app resolve a largura do DIGITO; o zero resolve
 * a quantidade deles.)
 */
export function formatarDuracao(inicioEm: string, ate: Date): string {
  const { horas, minutos } = duracaoJornada(inicioEm, ate);
  return `${horas}h${String(minutos).padStart(2, "0")}`;
}

/** A jornada esta aberta ha tempo demais pra ser plausivel? */
export function jornadaPrecisaAtencao(inicioEm: string, agora: Date): boolean {
  return agora.getTime() - Date.parse(inicioEm) >= JORNADA_LONGA_MS;
}
