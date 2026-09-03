/**
 * Feriados nacionais brasileiros — CALCULADOS, nao cadastrados.
 *
 * Uma lista digitada a mao erra por omissao, e erra sempre em dezembro: alguem
 * cadastra o ano que vem, esquece o seguinte, e um belo dia o sistema oferece
 * quarenta visitas no Natal. Calculado, ele nunca oferece — nem em 2031.
 *
 * So os NACIONAIS moram aqui. Municipal e estadual variam por cidade e nao ha
 * formula: esses ficam na tabela de excecoes, cadastrados por quem sabe.
 */

/** Os oito fixos, como `MM-DD`. */
const FIXOS: Record<string, string> = {
  "01-01": "Confraternização Universal",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "12-25": "Natal",
};

/**
 * Domingo de Pascoa de um ano, em UTC. Algoritmo de Meeus/Butcher (gregoriano).
 *
 * Existe porque quatro feriados nacionais sao contados A PARTIR dela e mudam
 * de data todo ano — sao justamente os que uma lista manual esquece.
 */
export function domingoDePascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marco, 4 = abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** `AAAA-MM-DD` de uma data UTC deslocada em dias. */
function emDias(base: Date, dias: number): string {
  const d = new Date(base.getTime() + dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Os feriados nacionais de um ano: `AAAA-MM-DD` -> nome.
 *
 * Carnaval entra com os dois dias (segunda e terca). Formalmente so a terca e
 * ponto facultativo nacional, mas nenhuma equipe de campo trabalha na segunda —
 * oferecer visita ali seria oferecer uma que ninguem faria.
 */
export function feriadosNacionais(ano: number): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const [md, nome] of Object.entries(FIXOS)) mapa.set(`${ano}-${md}`, nome);

  const pascoa = domingoDePascoa(ano);
  mapa.set(emDias(pascoa, -48), "Carnaval");
  mapa.set(emDias(pascoa, -47), "Carnaval");
  mapa.set(emDias(pascoa, -2), "Sexta-feira Santa");
  mapa.set(emDias(pascoa, 60), "Corpus Christi");
  return mapa;
}

/**
 * O nome do feriado nacional de um `AAAA-MM-DD`, ou `null`.
 *
 * Cache por ano porque a grade pergunta isto uma vez por dia do horizonte, a
 * cada consulta de vagas — e a resposta de um ano inteiro nunca muda.
 */
const porAno = new Map<number, Map<string, string>>();

export function feriadoNacional(dia: string): string | null {
  const ano = Number(dia.slice(0, 4));
  if (!Number.isInteger(ano)) return null;
  let mapa = porAno.get(ano);
  if (!mapa) {
    mapa = feriadosNacionais(ano);
    porAno.set(ano, mapa);
  }
  return mapa.get(dia) ?? null;
}
