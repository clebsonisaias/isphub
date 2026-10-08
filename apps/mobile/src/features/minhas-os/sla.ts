import { OS_STATUS_ABERTOS, compararVisita, type FilaItem, type SlaInfo, type TurnoAgenda } from "@isphub/shared";

/** "45min" · "3h 15min" · "2d 4h" a partir de minutos. */
export function fmtDuracao(min: number): string {
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Texto do selo de SLA: estourado mostra o atraso; senao o tempo restante. */
export function textoSla(sla: SlaInfo): string {
  if (sla.semaforo === "sem_sla" || sla.minutosRestantes == null) return "Sem prazo";
  if (sla.minutosRestantes < 0) return `Estourado · ${fmtDuracao(-sla.minutosRestantes)}`;
  return fmtDuracao(sla.minutosRestantes);
}

const PESO: Record<string, number> = { vermelho: 0, amarelo: 1, verde: 2, sem_sla: 3 };

/**
 * Ordena SLA-first: mais urgente primeiro (vermelho > amarelo > verde), e dentro
 * do mesmo semaforo, menos tempo restante primeiro. Nao muta o array recebido.
 */
export function ordenarSlaFirst(itens: FilaItem[]): FilaItem[] {
  return [...itens].sort((a, b) => {
    const pa = PESO[a.sla.semaforo] ?? 3;
    const pb = PESO[b.sla.semaforo] ?? 3;
    if (pa !== pb) return pa - pb;
    return (a.sla.minutosRestantes ?? Infinity) - (b.sla.minutosRestantes ?? Infinity);
  });
}

/**
 * Mais recente primeiro, sem data no fim — ordem de ARQUIVO, irma de
 * `ordenarSlaFirst`: naquela a pergunta e "o que estoura primeiro?", aqui e "o
 * que eu fiz por ultimo?". OS concluida nao tem SLA correndo pra ordenar.
 *
 * Sem data vai pro fim (nao pro topo): item sem agendamento e o menos util pra
 * quem esta procurando o servico de ontem.
 */
/**
 * Instante do agendamento pra fins de ORDENACAO, com `ausente` decidindo pra
 * que ponta vai quem nao tem data utilizavel.
 *
 * Existe porque `Date.parse` de string invalida devolve NaN, e um comparador
 * que devolve NaN deixa a ordem INDEFINIDA — a lista sai embaralhada sem erro
 * nenhum, sem excecao e sem sintoma ate alguem jurar que "sumiu uma OS". Data
 * ilegivel e tratada igual a data ausente.
 */
function instante(iso: string | null | undefined, ausente: number): number {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? ausente : t;
}

export function maisRecentesPrimeiro(itens: FilaItem[]): FilaItem[] {
  // Sem data vai pro FIM: quem procura o servico de ontem nao quer abrir a
  // tela num item sem agendamento nenhum.
  return [...itens].sort(
    (a, b) =>
      instante(b.dataAgendamento, Number.NEGATIVE_INFINITY) - instante(a.dataAgendamento, Number.NEGATIVE_INFINITY),
  );
}

/**
 * A ordem do dia: a rota do supervisor quando ela existe, o horário quando não.
 *
 * A rota ganha do horário de propósito. Quando o supervisor sequencia as
 * paradas, ele está decidindo o caminho — e ordenar por horário por cima disso
 * devolveria o técnico ao zigue-zague que a sequência existe pra evitar. Sem
 * rota definida, cedo primeiro; sem nenhum dos dois, pro fim, onde não
 * atrapalha a leitura.
 */
export function ordenarPorHorario(itens: FilaItem[]): FilaItem[] {
  const rota = (i: FilaItem) => i.ordemRota ?? Number.POSITIVE_INFINITY;
  return [...itens].sort(
    (a, b) =>
      rota(a) - rota(b) ||
      instante(a.dataAgendamento, Number.POSITIVE_INFINITY) - instante(b.dataAgendamento, Number.POSITIVE_INFINITY),
  );
}

/**
 * A agenda do dia em duas metades. Quem esta na agenda ISPhub tem turno; o
 * que veio so com a data do SGP (fallback) cai pela hora: antes do meio-dia e
 * manha. Dentro de cada turno vale a rota do supervisor, depois a hora.
 */
export function agruparPorTurno(itens: FilaItem[]): Record<TurnoAgenda, FilaItem[]> {
  const grupos: Record<TurnoAgenda, FilaItem[]> = { manha: [], tarde: [] };
  for (const i of itens) {
    const turno = i.turnoAgenda ?? turnoPelaHora(i.dataAgendamento);
    grupos[turno].push(i);
  }
  grupos.manha = ordenarPorHorario(grupos.manha);
  grupos.tarde = ordenarPorHorario(grupos.tarde);
  return grupos;
}

function turnoPelaHora(iso: string | null | undefined): TurnoAgenda {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(t)) return "manha";
  // -03:00 fixo, a mesma regra do servidor (`turnoBrDe`).
  const horaBr = (new Date(t).getUTCHours() + 24 - 3) % 24;
  return horaBr < 12 ? "manha" : "tarde";
}

/**
 * Qual OS o tecnico ataca agora. A ROTA do dia manda quando existe: o
 * supervisor sequenciou as paradas, e pular pra "mais urgente por SLA"
 * devolveria o zigue-zague que a rota existe pra evitar. Sem agenda (ou tudo
 * dela ja concluido), vale o SLA sobre a fila aberta.
 */
export function escolherProxima(abertas: FilaItem[], agendaHoje: FilaItem[]): FilaItem | undefined {
  const daRota = [...agendaHoje]
    .filter((i) => OS_STATUS_ABERTOS.includes(i.status))
    .sort((a, b) => compararVisita(a, b) || ordenarPorHorario([a, b])[0] === a ? -1 : 1);
  return daRota[0] ?? ordenarSlaFirst(abertas)[0];
}
