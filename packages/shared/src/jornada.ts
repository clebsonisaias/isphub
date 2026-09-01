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

/**
 * Por que a pausa existe: o tecnico para pra almocar e volta. Sem registrar
 * isso, o "tempo trabalhado" conta o almoco como trabalho — e o numero que o
 * supervisor usa pra medir o dia fica inflado exatamente na mesma medida em
 * todo mundo, todos os dias.
 */
export type MotivoPausa = "almoco" | "outro";

export const MOTIVO_PAUSA_LABEL: Record<MotivoPausa, string> = {
  almoco: "Almoço",
  outro: "Pausa",
};

/** Um intervalo parado dentro da jornada. `fimEm` nulo = em pausa AGORA. */
export interface PausaJornada {
  id: string;
  inicioEm: string;
  fimEm: string | null;
  motivo: MotivoPausa;
}

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
  /** Em ordem de inicio. Vazio quando o tecnico nao parou nenhuma vez. */
  pausas: PausaJornada[];
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


/** A pausa aberta agora, se houver. */
export function pausaAberta(pausas: PausaJornada[]): PausaJornada | null {
  return pausas.find((p) => p.fimEm === null) ?? null;
}

/**
 * Quanto tempo a jornada passou PARADA ate `ate`.
 *
 * A pausa aberta conta ate `ate` (o contador tem que correr enquanto o tecnico
 * almoca, senao "tempo em pausa" fica congelado justo enquanto ele esta em
 * pausa). Cada trecho e limitado a `ate` e ao proprio inicio: relogio torto ou
 * pausa carimbada no futuro nao pode gerar tempo negativo, que viraria tempo
 * trabalhado A MAIS.
 */
export function msEmPausa(pausas: PausaJornada[], ate: Date): number {
  return pausas.reduce((total, p) => {
    const de = Date.parse(p.inicioEm);
    const fim = p.fimEm ? Date.parse(p.fimEm) : ate.getTime();
    if (Number.isNaN(de) || Number.isNaN(fim)) return total;
    return total + Math.max(0, Math.min(fim, ate.getTime()) - de);
  }, 0);
}

/**
 * Tempo de fato TRABALHADO: o decorrido menos as pausas.
 *
 * E um numero diferente de `duracaoJornada`, que continua sendo o decorrido
 * bruto. Os dois interessam ao supervisor ("saiu as 7h, voltou as 17h" contra
 * "trabalhou 9h"), entao nenhum dos dois substitui o outro.
 */
export function duracaoTrabalhada(
  inicioEm: string,
  pausas: PausaJornada[],
  ate: Date,
): { horas: number; minutos: number; ms: number } {
  const bruto = duracaoJornada(inicioEm, ate).ms;
  const ms = Math.max(0, bruto - msEmPausa(pausas, ate));
  const totalMin = Math.floor(ms / 60_000);
  return { horas: Math.floor(totalMin / 60), minutos: totalMin % 60, ms };
}

/** "05h58" do tempo trabalhado — mesmo formato de `formatarDuracao`. */
export function formatarTrabalhado(inicioEm: string, pausas: PausaJornada[], ate: Date): string {
  const { horas, minutos } = duracaoTrabalhada(inicioEm, pausas, ate);
  return `${horas}h${String(minutos).padStart(2, "0")}`;
}
