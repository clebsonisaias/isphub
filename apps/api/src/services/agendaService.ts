import {
  capacidadeDerivada,
  dataDoDia,
  diaBrDe,
  diaDaSemana,
  feriadoNacional,
  HORA_INICIO_TURNO,
  mapSgpOsStatus,
  OS_STATUS_ABERTOS,
  somarDias,
  TURNOS_AGENDA,
  turnoDaHora,
  type AgendaConfigDto,
  type BloqueioVaga,
  type ExcecaoAgendaDto,
  type OsStatus,
  type ResultadoStatusOs,
  type TurnoAgenda,
  type VagaTurno,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { buildConnector } from "./erpConnectorService.js";

/**
 * A agenda de OS — a regra que a planilha nao tinha.
 *
 * A planilha AVISAVA depois do fato ("Verificar concentracao"), quando a
 * atendente ja tinha combinado o horario com o cliente e so restava ligar de
 * volta pra desmarcar. Aqui a oferta ja vem filtrada: `proximasVagas` nunca
 * devolve uma janela cheia, entao lotar o dia deixa de ser um aviso e passa a
 * ser simplesmente a proxima data que aparece na tela.
 *
 * Tudo que decide mora em funcoes PURAS na primeira metade do arquivo — sao
 * elas que respondem "cabe?", e testa-las nao deveria exigir banco.
 */

/** -03:00 fixo, a mesma decisao de `shared/dia.ts` e de `connectors/sgp.ts`. */
const OFFSET_BR_MIN = -180;

// As funcoes de dia civil moram no shared (web e mobile usam as mesmas);
// reexportadas aqui porque o resto da API e os testes sempre importaram daqui.
export { diaBrDe, dataDoDia, somarDias, diaDaSemana };

/** O turno brasileiro de um instante — usado pra reconciliar o que veio do SGP. */
export function turnoBrDe(instante: Date): TurnoAgenda {
  const local = new Date(instante.getTime() + OFFSET_BR_MIN * 60_000);
  return turnoDaHora(local.getUTCHours());
}

/** O instante UTC em que um turno de um dia COMECA. */
export function inicioDoTurno(dia: string, turno: TurnoAgenda): Date {
  const base = dataDoDia(dia).getTime();
  return new Date(base + HORA_INICIO_TURNO[turno] * 3_600_000 - OFFSET_BR_MIN * 60_000);
}

export function capacidadeDe(turno: TurnoAgenda, config: AgendaConfigDto): number {
  return turno === "manha" ? config.vagasManha : config.vagasTarde;
}

/** Quantas marcacoes ja existem numa janela, e como se dividem. */
export interface Ocupacao {
  total: number;
  instalacao: number;
  reparo: number;
  /** Na regiao consultada. `null` quando a consulta nao pediu regiao. */
  regiao: number | null;
  /** Quantas das ocupadas (`total`) sao da fila de retirada. */
  retirada?: number;
}

const VAZIA: Ocupacao = { total: 0, instalacao: 0, reparo: 0, regiao: null, retirada: 0 };

/**
 * O estado de UMA janela. E o coracao da regra, e e puro.
 *
 * A ordem dos bloqueios importa: dia nao atendido e antecedencia sao do
 * CALENDARIO e valem mesmo com a agenda vazia, entao vem antes de qualquer
 * contagem. Reportar "lotado" num domingo seria uma explicacao errada pra uma
 * recusa certa — e a atendente repetiria a pergunta pro proximo domingo.
 */
export function vagaDe(args: {
  dia: string;
  turno: TurnoAgenda;
  config: AgendaConfigDto;
  ocupacao?: Ocupacao;
  /** O total marcado no DIA (os dois turnos), pro teto diario. */
  ocupadasDia?: number;
  /** A excecao cadastrada pra este dia, quando houver. */
  excecao?: ExcecaoAgendaDto | undefined;
  /** Tecnicos escalados neste turno. Nulo/ausente = sem escala no dia (vale a fixa). */
  escalados?: number | null;
  agora: Date;
}): VagaTurno {
  const { dia, turno, config, agora, excecao } = args;
  const ocupacao = args.ocupacao ?? VAZIA;
  // Domingo tem teto proprio (vagasDomingo, padrao 4): e plantao, nao dia cheio.
  const capFixa = capacidadeDe(turno, config);
  const capDoDia = diaDaSemana(dia) === 0 && config.vagasDomingo != null ? Math.min(capFixa, config.vagasDomingo) : capFixa;
  const capacidade = capacidadeDerivada(capDoDia, args.escalados, config.vagasPorTecnico);
  const pelaEscala = config.vagasPorTecnico != null && args.escalados != null;
  const ocupadasDia = args.ocupadasDia ?? ocupacao.total;

  /*
   * A excecao com `atende: true` vence TUDO — inclusive domingo e feriado
   * nacional. E a decisao de uma pessoa que sabe o que vai acontecer naquele
   * dia, e nenhuma regra automatica deveria poder desfaze-la. Por isso ela sai
   * da corrente de bloqueios em vez de entrar nela como mais um `else if`.
   */
  const liberadoNaMao = excecao?.atende === true;
  const feriado = liberadoNaMao ? null : (excecao ? excecao.motivo : feriadoNacional(dia));

  let bloqueio: BloqueioVaga | null = null;
  let motivoBloqueio: string | null = null;
  if (feriado) {
    bloqueio = "feriado";
    motivoBloqueio = feriado;
  } else if (!liberadoNaMao && !config.diasAtendidos.includes(diaDaSemana(dia))) {
    bloqueio = "dia_nao_atendido";
  } else if (!liberadoNaMao && turno === "tarde" && [0, 6].includes(diaDaSemana(dia))) {
    // Sabado e domingo so tem a saida da manha: a equipe fecha ao meio-dia.
    // Fica atras de `liberadoNaMao` pelo mesmo motivo dos outros: um mutirao
    // cadastrado com `atende: true` abre a tarde tambem.
    // ponytail: regra fixa (sabado em 07/10/2026, domingo em 23/10/2026). Se a
    // tarde do fim de semana passar a variar, vira `diasSoManha Int[]` na AgendaConfig.
    bloqueio = "turno_nao_atendido";
  } else if (pelaEscala && capacidade === 0) {
    // A escala do dia existe e ninguem esta neste turno: nao e "lotado", e
    // "sem equipe" — a atendente precisa saber que escalar alguem abre a vaga.
    bloqueio = "sem_equipe";
  } else if (inicioDoTurno(dia, turno).getTime() - agora.getTime() < config.antecedenciaMin * 60_000) {
    bloqueio = "antecedencia";
  } else if (config.vagasDia != null && ocupadasDia >= config.vagasDia) {
    /*
     * Teto do DIA antes do teto do turno, de proposito: quando o dia fecha, os
     * DOIS turnos fecham, e dizer "manha lotada" mandaria a atendente tentar a
     * tarde do mesmo dia — que tambem nao tem. A recusa certa e "este dia nao
     * tem mais", e ela so aparece se este ramo vier primeiro.
     */
    bloqueio = "dia_lotado";
  } else if (ocupacao.total >= capacidade) {
    bloqueio = "lotado";
  } else if (config.tetoRegiao != null && ocupacao.regiao != null && ocupacao.regiao >= config.tetoRegiao) {
    // Teto regional: 20 visitas cabem no dia, mas nao TODAS no mesmo bairro —
    // e o deslocamento entre elas que a planilha nunca contou.
    bloqueio = "regiao";
  }

  /*
   * O que sobra e o MENOR dos dois limites. Sem isto, um dia com 28 de 30 e
   * dois turnos vazios anunciaria "20 livres" na manha — e a 3a marcacao seria
   * recusada depois de a atendente ja ter oferecido as vinte.
   */
  const livresNoTurno = capacidade - ocupacao.total;
  const livresNoDia = config.vagasDia != null ? config.vagasDia - ocupadasDia : Number.POSITIVE_INFINITY;

  return {
    dia,
    turno,
    capacidade,
    ocupadas: ocupacao.total,
    livres: bloqueio ? 0 : Math.max(0, Math.min(livresNoTurno, livresNoDia)),
    bloqueio,
    instalacao: ocupacao.instalacao,
    reparo: ocupacao.reparo,
    ocupadasRegiao: ocupacao.regiao,
    ocupadasDia,
    motivoBloqueio,
    tecnicosEscalados: pelaEscala ? (args.escalados ?? null) : null,
  };
}

/** Chave de uma janela nos mapas de ocupacao. */
export const chaveJanela = (dia: string, turno: TurnoAgenda) => `${dia}|${turno}`;

/**
 * A grade completa de um intervalo — a aba "Painel" da planilha, com bloqueio.
 */
export function montarGrade(args: {
  de: string;
  ate: string;
  config: AgendaConfigDto;
  ocupacoes: Map<string, Ocupacao>;
  /** `AAAA-MM-DD` -> excecao. Ausente = so o calendario automatico vale. */
  excecoes?: Map<string, ExcecaoAgendaDto>;
  /** `dia|turno` -> tecnicos escalados. Dia sem entrada = sem escala (vale a fixa). */
  escalados?: Map<string, number>;
  agora: Date;
}): VagaTurno[] {
  const grade: VagaTurno[] = [];
  for (let dia = args.de; dia <= args.ate; dia = somarDias(dia, 1)) {
    // O dia inteiro antes de olhar cada turno — o teto diario e sobre a soma.
    const ocupadasDia = TURNOS_AGENDA.reduce(
      (soma, t) => soma + (args.ocupacoes.get(chaveJanela(dia, t))?.total ?? 0),
      0,
    );
    for (const turno of TURNOS_AGENDA) {
      grade.push(
        vagaDe({
          dia,
          turno,
          config: args.config,
          ocupacao: args.ocupacoes.get(chaveJanela(dia, turno)),
          ocupadasDia,
          excecao: args.excecoes?.get(dia),
          escalados: args.escalados?.get(chaveJanela(dia, turno)),
          agora: args.agora,
        }),
      );
    }
  }
  return grade;
}

/**
 * As proximas `quantas` janelas que REALMENTE cabem.
 *
 * E esta funcao que faz "completou as 40, so tem pro outro dia": quem oferece
 * ao cliente — atendente, bot ou autoatendimento — le daqui, e o que nao cabe
 * simplesmente nao existe do lado de fora.
 */
export function proximasVagas(args: {
  agora: Date;
  config: AgendaConfigDto;
  ocupacoes: Map<string, Ocupacao>;
  excecoes?: Map<string, ExcecaoAgendaDto>;
  escalados?: Map<string, number>;
  quantas: number;
}): VagaTurno[] {
  const inicio = diaBrDe(args.agora);
  const fim = somarDias(inicio, args.config.horizonteDias);
  return montarGrade({
    de: inicio,
    ate: fim,
    config: args.config,
    ocupacoes: args.ocupacoes,
    excecoes: args.excecoes,
    escalados: args.escalados,
    agora: args.agora,
  })
    .filter((v) => v.bloqueio === null && v.livres > 0)
    .slice(0, args.quantas);
}

// ---------------------------------------------------------------------------
// Daqui pra baixo: banco.
// ---------------------------------------------------------------------------

/** Categorias que a operacao chama de "instalacao", pra quebrar a grade em duas. */
const PALAVRA_INSTALACAO = "instala";

export async function lerConfig(): Promise<AgendaConfigDto> {
  // A linha nasce na migracao. `upsert` aqui e rede: banco restaurado sem ela
  // nao pode derrubar a agenda inteira.
  const c = await prisma.agendaConfig.upsert({
    where: { id: "global" },
    create: { id: "global" },
    update: {},
  });
  return {
    vagasManha: c.vagasManha,
    vagasTarde: c.vagasTarde,
    vagasDia: c.vagasDia,
    tetoRegiao: c.tetoRegiao,
    diasAtendidos: c.diasAtendidos,
    horizonteDias: c.horizonteDias,
    antecedenciaMin: c.antecedenciaMin,
    remarcacoesMaxCliente: c.remarcacoesMaxCliente,
    baseLat: c.baseLat,
    baseLng: c.baseLng,
    vagasPorTecnico: c.vagasPorTecnico,
    vagasRetiradaDia: c.vagasRetiradaDia,
    autoAgendaAtiva: c.autoAgendaAtiva,
    autoAgendaMaxRodada: c.autoAgendaMaxRodada,
    vagasUrgenciaDia: c.vagasUrgenciaDia,
    vagasDomingo: c.vagasDomingo,
  };
}

export async function salvarConfig(patch: Partial<AgendaConfigDto>): Promise<AgendaConfigDto> {
  await prisma.agendaConfig.upsert({ where: { id: "global" }, create: { id: "global", ...patch }, update: patch });
  return lerConfig();
}

/**
 * Conta o que ja esta marcado em cada janela do intervalo.
 *
 * Uma consulta agrupada em vez de uma por dia: 14 dias x 2 turnos seriam 28
 * idas ao banco a cada vez que alguem abre a tela.
 */
export async function ocupacoesEntre(
  de: string,
  ate: string,
  regiao?: string | null,
  equipe?: "interna" | "externa" | "todas",
): Promise<Map<string, Ocupacao>> {
  const linhas = await prisma.agendamento.findMany({
    where: { status: "marcado", dia: { gte: dataDoDia(de), lte: dataDoDia(ate) } },
    select: {
      dia: true,
      turno: true,
      regiao: true,
      fila: true,
      ordemServico: { select: { tipoOs: { select: { categoria: { select: { nome: true, equipeExterna: true } } } } } },
    },
  });

  const mapa = new Map<string, Ocupacao>();
  for (const l of linhas) {
    const ehRetirada = l.fila === "retirada" || l.ordemServico?.tipoOs?.categoria?.equipeExterna === true;
    if (equipe === "interna" && ehRetirada) continue;
    if (equipe === "externa" && !ehRetirada) continue;

    const chave = chaveJanela(l.dia.toISOString().slice(0, 10), l.turno);
    const atual = mapa.get(chave) ?? { total: 0, instalacao: 0, reparo: 0, regiao: regiao ? 0 : null, retirada: 0 };
    // A retirada ocupa vaga do turno como qualquer visita; `retirada` so diz
    // quantas das ocupadas sao dela (a fatia reservada e calculada em cima disso).
    if (l.fila === "retirada") atual.retirada = (atual.retirada ?? 0) + 1;
    atual.total += 1;
    // Instalacao x reparo e so pro painel (a planilha tinha uma aba pra cada);
    // o TETO e compartilhado, porque sao os mesmos tecnicos nos dois tipos.
    const categoria = l.ordemServico?.tipoOs?.categoria?.nome?.toLowerCase() ?? "";
    if (categoria.includes(PALAVRA_INSTALACAO)) atual.instalacao += 1;
    else atual.reparo += 1;
    if (regiao && l.regiao === regiao) atual.regiao = (atual.regiao ?? 0) + 1;
    mapa.set(chave, atual);
  }
  return mapa;
}

/**
 * As excecoes de calendario de um intervalo, prontas pra `montarGrade`.
 *
 * Uma consulta so pro periodo inteiro, como o mapa de ocupacoes: perguntar dia
 * a dia seriam 15 idas ao banco a cada vez que alguem abre a tela.
 */
export async function excecoesEntre(de: string, ate: string): Promise<Map<string, ExcecaoAgendaDto>> {
  const linhas = await prisma.excecaoAgenda.findMany({
    where: { dia: { gte: dataDoDia(de), lte: dataDoDia(ate) } },
    select: { dia: true, atende: true, motivo: true },
  });
  return new Map(
    linhas.map((l) => {
      const dia = l.dia.toISOString().slice(0, 10);
      return [dia, { dia, atende: l.atende, motivo: l.motivo }];
    }),
  );
}

/**
 * Tecnicos escalados por `dia|turno` no intervalo. Conta so quem esta de pe
 * (sem ausencia) e ativo. Dia sem nenhuma linha de escala NAO entra no mapa —
 * e assim que a grade sabe que ali vale a capacidade fixa.
 */
export async function escaladosEntre(de: string, ate: string): Promise<Map<string, number>> {
  const linhas = await prisma.escalaJornada.findMany({
    where: { dia: { gte: dataDoDia(de), lte: dataDoDia(ate) }, usuario: { ativo: true, role: "tecnico" } },
    select: { dia: true, turnos: true, ausenteEm: true },
  });
  const mapa = new Map<string, number>();
  for (const l of linhas) {
    const dia = l.dia.toISOString().slice(0, 10);
    // O dia passa a existir no mapa mesmo com todo mundo ausente: zero e uma
    // resposta ("sem equipe"), ausencia de entrada e outra ("sem escala").
    for (const t of TURNOS_AGENDA) mapa.set(chaveJanela(dia, t), mapa.get(chaveJanela(dia, t)) ?? 0);
    if (l.ausenteEm) continue;
    for (const t of l.turnos) mapa.set(chaveJanela(dia, t), (mapa.get(chaveJanela(dia, t)) ?? 0) + 1);
  }
  return mapa;
}

export async function grade(args: {
  de: string;
  ate: string;
  regiao?: string | null;
  agora?: Date;
  equipe?: "interna" | "externa" | "todas";
}) {
  const config = await lerConfig();
  const [ocupacoes, excecoes, escalados] = await Promise.all([
    ocupacoesEntre(args.de, args.ate, args.regiao, args.equipe),
    excecoesEntre(args.de, args.ate),
    config.vagasPorTecnico != null ? escaladosEntre(args.de, args.ate) : undefined,
  ]);
  return montarGrade({
    de: args.de,
    ate: args.ate,
    config,
    ocupacoes,
    excecoes,
    escalados,
    agora: args.agora ?? new Date(),
  });
}

/**
 * As proximas janelas que cabem, montadas do banco.
 *
 * Existe pra ninguem mais montar isso a mao: quem chamava `proximasVagas`
 * direto tinha que lembrar de carregar ocupacoes E excecoes, e esquecer a
 * segunda fazia a grade do supervisor bloquear o feriado enquanto o bot
 * continuava oferecendo o mesmo dia. Uma funcao, todos os chamadores.
 */
export async function proximasVagasDoBanco(args: {
  regiao?: string | null;
  quantas: number;
  agora?: Date;
}): Promise<VagaTurno[]> {
  const agora = args.agora ?? new Date();
  const config = await lerConfig();
  const hoje = diaBrDe(agora);
  const ate = somarDias(hoje, config.horizonteDias);
  const [ocupacoes, excecoes, escalados] = await Promise.all([
    ocupacoesEntre(hoje, ate, args.regiao),
    excecoesEntre(hoje, ate),
    config.vagasPorTecnico != null ? escaladosEntre(hoje, ate) : undefined,
  ]);
  return proximasVagas({ agora, config, ocupacoes, excecoes, escalados, quantas: args.quantas });
}

/** As excecoes cadastradas a partir de hoje — a lista da tela do supervisor. */
export async function listarExcecoes(deHoje = true) {
  return prisma.excecaoAgenda.findMany({
    where: deHoje ? { dia: { gte: dataDoDia(diaBrDe(new Date())) } } : {},
    orderBy: { dia: "asc" },
    select: { id: true, dia: true, atende: true, motivo: true, definidoPor: true },
  });
}

/**
 * Cadastra (ou corrige) a excecao de um dia.
 *
 * Upsert pela data, nao insert: recadastrar o mesmo dia ATUALIZA a regra. Duas
 * linhas pro mesmo dia poderiam discordar, e nada no sistema saberia qual delas
 * vale.
 */
export async function salvarExcecao(args: { dia: string; atende: boolean; motivo: string; definidoPor?: string | null }) {
  const dados = { atende: args.atende, motivo: args.motivo, definidoPor: args.definidoPor ?? null };
  return prisma.excecaoAgenda.upsert({
    where: { dia: dataDoDia(args.dia) },
    create: { dia: dataDoDia(args.dia), ...dados },
    update: dados,
  });
}

export async function removerExcecao(dia: string) {
  await prisma.excecaoAgenda.deleteMany({ where: { dia: dataDoDia(dia) } });
}

export interface MarcarArgs {
  provedorId: string;
  sgpOsId: string;
  dia: string;
  turno: TurnoAgenda;
  regiao?: string | null;
  origem: string;
  marcadoPor?: string | null;
  observacao?: string | null;
  /** Fila que consome a vaga; omitida, nao mexe no que a marcacao ja tinha. */
  fila?: "normal" | "retirada";
  /**
   * So o robo da planilha usa: enquanto ela for a fonte, o que a atendente ja
   * combinou la entra mesmo acima do teto (decisao de 23/10/2026). Ignora SO a
   * lotacao (turno, dia, regiao) — feriado e dia/turno fechado continuam valendo.
   */
  ignorarLotacao?: boolean;
  /** De onde veio a marcacao, para a trilha (AtendAI: canal, protocolo, se a OS ja estava aberta). */
  contexto?: ContextoEvento;
}

/** Bloqueios de LOTACAO — os unicos que `ignorarLotacao` atravessa. */
const BLOQUEIOS_DE_LOTACAO = new Set(["lotado", "dia_lotado", "regiao"]);

/**
 * Recusa que o CLIENTE recebeu por regra de autoatendimento, nao por lotacao.
 *
 * Tipo proprio porque a resposta certa e outra: turno cheio manda oferecer
 * outra data; isto aqui manda chamar um humano. Quem chama precisa distinguir
 * sem ler a mensagem.
 */
export class LimiteDoCliente extends HttpError {
  constructor(
    message: string,
    readonly motivo: "max_remarcacoes" | "tarde_demais" | "sem_marcacao",
  ) {
    super(409, message);
  }
}

/**
 * As regras que valem SO pro cliente remarcando sozinho. Pura, e por isso
 * testavel sem banco.
 *
 * Nao entram em `vagaDe` de proposito: `vagaDe` responde "cabe na rua?", e a
 * resposta e a mesma pra todo mundo. Isto aqui responde "esta pessoa pode?",
 * que e outra pergunta e so existe pro autoatendimento.
 */
export function podeClienteRemarcar(args: {
  atual: { dia: string; remarcacoesCliente: number } | null;
  hoje: string;
  max: number;
}): LimiteDoCliente | null {
  if (!args.atual) {
    return new LimiteDoCliente("Nao encontrei uma visita marcada para remarcar.", "sem_marcacao");
  }
  if (args.atual.remarcacoesCliente >= args.max) {
    return new LimiteDoCliente(
      "Voce ja remarcou esta visita o maximo de vezes. Vou te passar para um atendente.",
      "max_remarcacoes",
    );
  }
  /*
   * "Ate a vespera": chegou o dia da visita, so um humano remarca. O tecnico ja
   * saiu com a rota daquele dia na mao, e trocar a parada dele pelo WhatsApp do
   * cliente e como o dia da errado sem ninguem perceber.
   */
  if (args.atual.dia <= args.hoje) {
    return new LimiteDoCliente(
      "A visita e hoje — nao da mais para remarcar por aqui. Vou te passar para um atendente.",
      "tarde_demais",
    );
  }
  return null;
}

/**
 * Marca (ou remarca) uma OS. Recusa quando nao cabe.
 *
 * Serializado por (dia, turno) com advisory lock: sem ele, duas atendentes que
 * conferem a ultima vaga no mesmo segundo marcam as duas, e o teto que existe
 * pra proteger a rua e furado exatamente no dia mais cheio — o unico em que ele
 * importava.
 *
 * ponytail: a trava e por janela, entao so concorre quem disputa o MESMO turno.
 * Se um dia a capacidade subir a ponto de a contencao pesar, particionar a
 * chave por regiao.
 */
/**
 * Visita só para OS que existe e está ABERTA — de qualquer tipo (regra do
 * usuário, 23/10/2026). Devolve o motivo da recusa, ou nulo quando pode marcar.
 *
 * `espelho` = status da OS no espelho (nulo = ainda não chegou); `sgp` = o que o
 * SGP diz quando ela não está no espelho (nulo = não consultado). SGP fora do ar
 * ("indeterminado") passa: a OS acabou de ser aberta pelo próprio atendimento, e
 * o sync confere depois — travar a conversa com o cliente por isso seria pior.
 */
export function motivoSemVisita(espelho: OsStatus | null, sgp: ResultadoStatusOs | null): string | null {
  const aberta = (s: OsStatus) => OS_STATUS_ABERTOS.includes(s);
  if (espelho) return aberta(espelho) ? null : "Esta OS já foi encerrada; só OS aberta recebe visita.";
  if (!sgp || sgp.tipo === "indeterminado") return null;
  if (sgp.tipo === "ausente") return "Esta OS não existe no SGP do provedor.";
  return aberta(mapSgpOsStatus(sgp.statusBruto)) ? null : "Esta OS já foi encerrada no SGP; só OS aberta recebe visita.";
}

/** O status da OS direto no SGP do provedor (quando ela ainda não está no espelho). Nulo = sem SGP ativo. */
export async function statusNoSgp(provedorId: string, sgpOsId: string): Promise<ResultadoStatusOs | null> {
  const config = await prisma.erpConfig.findFirst({ where: { provedorId, tipo: "SGP", ativo: true } });
  if (!config) return null;
  try {
    return await buildConnector(config).obterStatusOs(sgpOsId);
  } catch (e) {
    return { tipo: "indeterminado", motivo: e instanceof Error ? e.message : String(e) };
  }
}

/** O que acompanha um evento da trilha quando ele vem de uma conversa. */
export interface ContextoEvento {
  canal?: string | null;
  protocolo?: string | null;
  conversaRef?: string | null;
  /** "ja_aberta" | "aberta_agora" */
  osSituacao?: string | null;
}

/**
 * Que evento uma marcacao gera. Nulo = nada mudou para a trilha (a mesma janela de novo,
 * por exemplo so trocando a observacao).
 */
export function tipoDaMarcacao(
  jaTinha: { dia: Date; turno: TurnoAgenda; status: string } | null,
  dia: string,
  turno: TurnoAgenda,
): "marcado" | "remarcado" | null {
  if (!jaTinha || jaTinha.status !== "marcado") return "marcado";
  const mesma = jaTinha.dia.toISOString().slice(0, 10) === dia && jaTinha.turno === turno;
  return mesma ? null : "remarcado";
}

type TxEvento = Pick<typeof prisma, "agendamentoEvento">;

/** Grava um evento na trilha. Dentro da transacao de quem chamou: so registra o que de fato aconteceu. */
export async function registrarEvento(
  tx: TxEvento,
  e: {
    provedorId: string;
    sgpOsId: string;
    agendamentoId?: string | null;
    tipo: "os_aberta" | "marcado" | "remarcado" | "desmarcado" | "confirmado" | "oferta_enviada" | "oferta_sem_retorno";
    dia?: Date | null;
    turno?: TurnoAgenda | null;
    diaAnterior?: Date | null;
    turnoAnterior?: TurnoAgenda | null;
    origem: string;
    autor?: string | null;
    contexto?: ContextoEvento;
  },
) {
  const { contexto, ...resto } = e;
  await tx.agendamentoEvento.create({
    data: {
      ...resto,
      canal: contexto?.canal ?? null,
      protocolo: contexto?.protocolo ?? null,
      conversaRef: contexto?.conversaRef ?? null,
      osSituacao: contexto?.osSituacao ?? null,
    },
  });
}

export async function marcar(args: MarcarArgs) {
  const config = await lerConfig();
  // A excecao do dia entra na checagem: sem ela, marcar direto (sem passar
  // pela oferta) furaria o feriado — e e exatamente assim que o AtendAI marca.
  const excecoes = await excecoesEntre(args.dia, args.dia);
  const escalados = config.vagasPorTecnico != null ? await escaladosEntre(args.dia, args.dia) : undefined;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agenda:${args.dia}:${args.turno}`}))`;

    const jaTinha = await tx.agendamento.findUnique({
      where: { provedorId_sgpOsId: { provedorId: args.provedorId, sgpOsId: args.sgpOsId } },
      select: { id: true, dia: true, turno: true, status: true },
    });

    // Remarcar pra janela onde a OS JA esta nao pode ser recusado por lotacao:
    // ela e uma das ocupadas, entao a propria marcacao competiria consigo mesma.
    const mesmaJanela =
      jaTinha?.status === "marcado" &&
      jaTinha.dia.toISOString().slice(0, 10) === args.dia &&
      jaTinha.turno === args.turno;

    if (!mesmaJanela) {
      const ocupacoes = await ocupacoesNaTransacao(tx, args.dia, args.regiao ?? null);
      const vaga = vagaDe({
        dia: args.dia,
        turno: args.turno,
        config,
        ocupacao: ocupacoes.get(chaveJanela(args.dia, args.turno)),
        ocupadasDia: TURNOS_AGENDA.reduce(
          (soma, t) => soma + (ocupacoes.get(chaveJanela(args.dia, t))?.total ?? 0),
          0,
        ),
        excecao: excecoes.get(args.dia),
        escalados: escalados?.get(chaveJanela(args.dia, args.turno)),
        agora: new Date(),
      });
      if (vaga.bloqueio && !(args.ignorarLotacao && BLOQUEIOS_DE_LOTACAO.has(vaga.bloqueio))) {
        throw new HttpError(409, motivoRecusa(vaga.bloqueio));
      }
    }

    // Liga na OS espelhada SE ela ja chegou. Quando nao, fica nulo e o sync
    // resolve depois — e por isso que dava pra marcar antes de a OS existir.
    const os = await tx.ordemServico.findUnique({
      where: { provedorId_sgpOsId: { provedorId: args.provedorId, sgpOsId: args.sgpOsId } },
      select: { id: true, status: true },
    });
    // 422 e nao 409: o AtendAI le 409 como "nao cabe" e reoferece vagas; aqui a OS e que nao serve.
    const semVisita = motivoSemVisita((os?.status ?? null) as OsStatus | null, null);
    if (semVisita) throw new HttpError(422, semVisita);

    const dados = {
      dia: dataDoDia(args.dia),
      turno: args.turno,
      regiao: args.regiao ?? null,
      origem: args.origem,
      marcadoPor: args.marcadoPor ?? null,
      // Ausente = mantem a observacao que a visita ja tinha (remarcar pela tela
      // nao pode apagar o "cliente so ate 16h" que a atendente anotou).
      observacao: args.observacao === undefined ? undefined : args.observacao,
      fila: args.fila,
      status: "marcado" as const,
      ordemServicoId: os?.id ?? null,
      // So muda quando quem marcou disse; ausente mantem o que a marcacao tinha.
      osSituacao: args.contexto?.osSituacao === undefined ? undefined : args.contexto.osSituacao,
      // Remarcar invalida a confirmacao anterior: o SGP ainda tem a data velha.
      sgpConfirmadoEm: null,
      // Remarcar tira a OS da rota do dia antigo — a ordem la nao significa
      // mais nada, e mante-la deixaria dois dias reivindicando a mesma parada.
      ordemRota: mesmaJanela ? undefined : null,
    };

    const salvo = await tx.agendamento.upsert({
      where: { provedorId_sgpOsId: { provedorId: args.provedorId, sgpOsId: args.sgpOsId } },
      create: { provedorId: args.provedorId, sgpOsId: args.sgpOsId, ...dados },
      update: dados,
    });

    const tipo = tipoDaMarcacao(jaTinha, args.dia, args.turno);
    if (tipo) {
      await registrarEvento(tx, {
        provedorId: args.provedorId,
        sgpOsId: args.sgpOsId,
        agendamentoId: salvo.id,
        tipo,
        dia: salvo.dia,
        turno: salvo.turno,
        ...(tipo === "remarcado" ? { diaAnterior: jaTinha!.dia, turnoAnterior: jaTinha!.turno } : {}),
        origem: args.origem,
        autor: args.marcadoPor ?? null,
        contexto: args.contexto,
      });
    }
    return salvo;
  });
}

/** A recusa em portugues de operacao, nao em vocabulario de banco. */
export function motivoRecusa(bloqueio: BloqueioVaga): string {
  switch (bloqueio) {
    case "lotado":
      return "Turno lotado — escolha outro dia ou turno.";
    case "dia_lotado":
      // Nao manda "tente outro turno": o dia inteiro fechou, e os dois turnos
      // dariam a mesma recusa.
      return "Dia lotado — escolha outra data.";
    case "regiao":
      return "Limite da regiao atingido neste turno — escolha outro dia ou turno.";
    case "dia_nao_atendido":
      return "Nao ha atendimento neste dia da semana.";
    case "turno_nao_atendido":
      return "Sabado e domingo so tem atendimento de manha — escolha a manha ou outro dia.";
    case "sem_equipe":
      return "Ninguem escalado neste turno — escale alguem ou escolha outro dia.";
    case "feriado":
      return "Nao ha atendimento neste dia (feriado).";
    case "antecedencia":
      return "Turno muito proximo — escolha um horario mais a frente.";
  }
}

/** A ocupacao de um dia, dentro da transacao que ja segura a trava. */
async function ocupacoesNaTransacao(
  tx: Pick<typeof prisma, "agendamento">,
  dia: string,
  regiao: string | null,
): Promise<Map<string, Ocupacao>> {
  const linhas = await tx.agendamento.findMany({
    where: { status: "marcado", dia: dataDoDia(dia) },
    select: { turno: true, regiao: true },
  });
  const mapa = new Map<string, Ocupacao>();
  for (const l of linhas) {
    const chave = chaveJanela(dia, l.turno);
    const atual = mapa.get(chave) ?? { total: 0, instalacao: 0, reparo: 0, regiao: regiao ? 0 : null, retirada: 0 };
    atual.total += 1;
    if (regiao && l.regiao === regiao) atual.regiao = (atual.regiao ?? 0) + 1;
    mapa.set(chave, atual);
  }
  return mapa;
}

export async function cancelar(
  id: string,
  /** Quem desmarcou, para a trilha. Ausente = "isphub" sem autor. */
  quem: { origem: string; autor?: string | null; contexto?: ContextoEvento } = { origem: "isphub" },
) {
  // Cancela em vez de apagar: a vaga volta a ficar livre do mesmo jeito, mas
  // "esta OS ja foi marcada e desmarcada" continua sendo uma pergunta
  // respondivel — e e a que aparece quando o cliente reclama.
  return prisma.$transaction(async (tx) => {
    const antes = await tx.agendamento.findUnique({ where: { id }, select: { status: true } });
    const cancelado = await tx.agendamento.update({ where: { id }, data: { status: "cancelado", ordemRota: null } });
    if (antes?.status === "marcado") {
      await registrarEvento(tx, {
        provedorId: cancelado.provedorId,
        sgpOsId: cancelado.sgpOsId,
        agendamentoId: cancelado.id,
        tipo: "desmarcado",
        dia: cancelado.dia,
        turno: cancelado.turno,
        origem: quem.origem,
        autor: quem.autor ?? null,
        contexto: quem.contexto,
      });
    }
    return cancelado;
  });
}

/** As marcacoes de uma janela, na ordem da rota. A lista do supervisor. */
export async function doTurno(
  dia: string,
  turno: TurnoAgenda,
  provedorId?: string,
  equipe?: "interna" | "externa" | "todas",
) {
  const where: Record<string, unknown> = {
    dia: dataDoDia(dia),
    turno,
    status: "marcado",
    ...(provedorId ? { provedorId } : {}),
  };

  if (equipe === "interna") {
    where.fila = { not: "retirada" };
    where.OR = [
      { ordemServicoId: null },
      {
        ordemServico: {
          OR: [
            { tipoOsId: null },
            { tipoOs: { categoriaId: null } },
            { tipoOs: { categoria: { equipeExterna: false } } },
          ],
        },
      },
    ];
  } else if (equipe === "externa") {
    where.OR = [
      { fila: "retirada" },
      { ordemServico: { tipoOs: { categoria: { equipeExterna: true } } } },
    ];
  }

  return prisma.agendamento.findMany({
    where,
    orderBy: [{ ordemRota: { sort: "asc", nulls: "last" } }, { criadoEm: "asc" }],
    select: {
      id: true,
      sgpOsId: true,
      ordemRota: true,
      regiao: true,
      fila: true,
      origem: true,
      marcadoPor: true,
      observacao: true,
      sgpConfirmadoEm: true,
      confirmadoEm: true,
      solicitouReagendamento: true,
      lembreteEnviadoEm: true,
      remarcacoesCliente: true,
      provedor: { select: { id: true, nome: true, cor: true } },
      ordemServico: {
        select: {
          id: true,
          status: true,
          clienteNome: true,
          telefone: true,
          bairro: true,
          logradouro: true,
          numero: true,
          cidade: true,
          pop: true,
          // Pro mapa da rota desenhar a parada sem passar pela fila (e seu teto).
          lat: true,
          lng: true,
          tecnico: { select: { id: true, nome: true, nomeExibicao: true } },
          apoios: { select: { id: true, nome: true, nomeExibicao: true } },
          tipoOs: { select: { descricao: true, categoria: { select: { nome: true, cor: true, equipeExterna: true } } } },
        },
      },
    },
  });
}

/**
 * Grava a ordem da rota de uma janela inteira, de uma vez.
 *
 * Em lote e nao um PATCH por parada porque arrastar UMA linha renumera todas as
 * outras: mandar uma requisicao por posicao deixaria a tela com metade da nova
 * ordem e metade da antiga se qualquer uma falhasse.
 */
export async function definirRota(ids: string[]) {
  await prisma.$transaction(ids.map((id, i) => prisma.agendamento.update({ where: { id }, data: { ordemRota: i + 1 } })));
}

/**
 * Cria a marcacao de uma OS que foi agendada DIRETO no SGP.
 *
 * Sem isto a contagem mentiria por omissao: o provedor marca uma visita no
 * proprio SGP, a vaga e consumida na rua e a grade continua mostrando o turno
 * vazio — que e como a planilha se enganava, so que sem ninguem perceber.
 *
 * Idempotente pela chave (provedorId, sgpOsId): rodar de novo nao duplica, e
 * NAO sobrescreve marcacao feita daqui — quem marcou pelo ISPhub mandou por
 * ultimo, e o write-back e que deve alinhar o SGP, nao o contrario.
 */
export async function reconciliarDoSgp(
  linhas: { provedorId: string; sgpOsId: string; ordemServicoId: string; dataAgendamento: Date; regiao: string | null }[],
) {
  if (linhas.length === 0) return 0;
  // Quais ainda nao tinham marcacao: so essas viram evento ("o SGP ja trazia a data").
  const existentes = await prisma.agendamento.findMany({
    where: { OR: linhas.map((l) => ({ provedorId: l.provedorId, sgpOsId: l.sgpOsId })) },
    select: { provedorId: true, sgpOsId: true },
  });
  const ja = new Set(existentes.map((e) => `${e.provedorId}:${e.sgpOsId}`));
  const resultado = await prisma.agendamento.createMany({
    data: linhas.map((l) => ({
      provedorId: l.provedorId,
      sgpOsId: l.sgpOsId,
      ordemServicoId: l.ordemServicoId,
      dia: dataDoDia(diaBrDe(l.dataAgendamento)),
      turno: turnoBrDe(l.dataAgendamento),
      regiao: l.regiao,
      origem: "sgp",
      // Veio de la: por definicao o SGP ja concorda com esta data.
      sgpConfirmadoEm: new Date(),
    })),
    skipDuplicates: true,
  });
  const novas = linhas.filter((l) => !ja.has(`${l.provedorId}:${l.sgpOsId}`));
  if (novas.length) {
    await prisma.agendamentoEvento.createMany({
      data: novas.map((l) => ({
        provedorId: l.provedorId,
        sgpOsId: l.sgpOsId,
        tipo: "marcado",
        dia: dataDoDia(diaBrDe(l.dataAgendamento)),
        turno: turnoBrDe(l.dataAgendamento),
        origem: "sgp",
        autor: "SGP",
      })),
    });
  }
  return resultado.count;
}

/**
 * Liga marcacoes orfas as OS que o sync finalmente espelhou.
 *
 * A orfandade e normal e temporaria: o atendimento marca no instante em que
 * abre a OS no SGP, e o espelho so a ve no ciclo seguinte.
 */
export async function ligarOrfas(provedorId: string) {
  const orfas = await prisma.agendamento.findMany({
    where: { provedorId, ordemServicoId: null, status: "marcado" },
    select: { id: true, sgpOsId: true },
  });
  if (orfas.length === 0) return 0;

  const oss = await prisma.ordemServico.findMany({
    where: { provedorId, sgpOsId: { in: orfas.map((o) => o.sgpOsId) } },
    select: { id: true, sgpOsId: true },
  });
  const porSgpId = new Map(oss.map((o) => [o.sgpOsId, o.id]));

  let ligadas = 0;
  for (const orfa of orfas) {
    const osId = porSgpId.get(orfa.sgpOsId);
    if (!osId) continue;
    await prisma.agendamento.update({ where: { id: orfa.id }, data: { ordemServicoId: osId } });
    ligadas += 1;
  }
  return ligadas;
}

// ---------------------------------------------------------------------------
// Write-back pro SGP — best-effort, e por bons motivos.
// ---------------------------------------------------------------------------

/**
 * Manda a data marcada pro SGP do provedor.
 *
 * Roda DEPOIS de a marcacao ja estar gravada aqui, e nunca derruba a marcacao:
 * a agenda da ISPhub e a fonte da verdade, e o SGP e quem precisa alcanca-la.
 * O inverso — exigir o SGP pra confirmar a vaga — deixaria a atendente sem
 * poder marcar toda vez que o ERP do provedor estivesse fora do ar, que e
 * justamente quando o telefone toca mais.
 *
 * NAO grava `sgpConfirmadoEm`: a chamada ter dado 200 nao e evidencia de que o
 * campo foi aceito (ver `scheduleOs` no contrato do conector). Quem confirma e
 * `confirmarComSgp`, lendo de volta.
 */
export async function enviarAoSgp(agendamentoId: string): Promise<boolean> {
  const a = await prisma.agendamento.findUnique({
    where: { id: agendamentoId },
    select: { sgpOsId: true, dia: true, turno: true, provedorId: true, status: true },
  });
  if (!a || a.status !== "marcado") return false;

  const erp = await prisma.erpConfig.findFirst({
    where: { provedorId: a.provedorId, ativo: true },
    select: { tipo: true, url: true, app: true, tokenCifrado: true },
  });
  if (!erp) return false;

  try {
    const dia = a.dia.toISOString().slice(0, 10);
    await buildConnector(erp).scheduleOs(a.sgpOsId, inicioDoTurno(dia, a.turno));
    return true;
  } catch (e) {
    console.warn(`[agenda] write-back da OS ${a.sgpOsId} falhou:`, e);
    return false;
  }
}

/**
 * Limpa no SGP a data de uma marcacao que foi CANCELADA aqui.
 *
 * Mesmo desenho de `enviarAoSgp`: roda depois de a resposta ja ter saido, e
 * nunca desfaz o cancelamento — o SGP fora do ar nao pode impedir o
 * supervisor de desmarcar. So age se a marcacao esta mesmo cancelada, pra
 * uma remarcacao concorrente nao ter a data nova apagada por engano.
 */
export async function limparNoSgp(agendamentoId: string): Promise<boolean> {
  const a = await prisma.agendamento.findUnique({
    where: { id: agendamentoId },
    select: { sgpOsId: true, provedorId: true, status: true },
  });
  if (!a || a.status !== "cancelado") return false;

  const erp = await prisma.erpConfig.findFirst({
    where: { provedorId: a.provedorId, ativo: true },
    select: { tipo: true, url: true, app: true, tokenCifrado: true },
  });
  if (!erp) return false;

  try {
    await buildConnector(erp).unscheduleOs(a.sgpOsId);
    return true;
  } catch (e) {
    console.warn(`[agenda] limpar data da OS ${a.sgpOsId} no SGP falhou:`, e);
    return false;
  }
}

/**
 * Confirma as marcacoes que o SGP realmente absorveu.
 *
 * Roda no sync, sobre o que ACABOU de ser lido do SGP. E o unico jeito honesto
 * de dizer "o ERP concorda": comparar a data que o espelho trouxe com a que
 * marcamos. Enquanto nao bater, `sgpConfirmadoEm` fica nulo e a tela mostra a
 * pendencia — em vez de garantir uma gravacao que pode nunca ter acontecido.
 */
export async function confirmarComSgp(provedorId: string): Promise<number> {
  const pendentes = await prisma.agendamento.findMany({
    where: { provedorId, status: "marcado", sgpConfirmadoEm: null, ordemServicoId: { not: null } },
    select: { id: true, dia: true, turno: true, ordemServico: { select: { dataAgendamento: true } } },
    take: 500,
  });

  const confirmados = pendentes
    .filter((p) => {
      const noSgp = p.ordemServico?.dataAgendamento;
      if (!noSgp) return false;
      // Dia e turno, nao o instante: o SGP pode normalizar o horario dentro do
      // turno (8h vira 8h30 na agenda dele) sem que a visita tenha mudado.
      return diaBrDe(noSgp) === p.dia.toISOString().slice(0, 10) && turnoBrDe(noSgp) === p.turno;
    })
    .map((p) => p.id);

  if (confirmados.length === 0) return 0;
  const r = await prisma.agendamento.updateMany({
    where: { id: { in: confirmados } },
    data: { sgpConfirmadoEm: new Date() },
  });
  return r.count;
}

/**
 * Reenvia ao SGP as visitas que ele ainda não confirmou: o envio na hora de
 * marcar é tiro único, e se falhou (SGP fora do ar, ou o campo errado que
 * existiu até 29/10/2026) a data nunca chegava. Só visita futura de OS aberta,
 * marcada/mexida há mais de 15 min (para não atropelar o envio da própria
 * marcação). O `confirmarComSgp` do ciclo seguinte encerra a repetição.
 */
export async function reenviarNaoConfirmadas(provedorId: string, agora = new Date()): Promise<number> {
  const pendentes = await prisma.agendamento.findMany({
    where: {
      provedorId,
      status: "marcado",
      sgpConfirmadoEm: null,
      dia: { gte: dataDoDia(diaBrDe(agora)) },
      atualizadoEm: { lt: new Date(agora.getTime() - 15 * 60_000) },
      ordemServico: { status: { in: ["aberta", "pendente"] } },
    },
    select: { id: true },
    orderBy: { dia: "asc" },
    // ponytail: 30 por ciclo (~3 min) limita a carga no SGP; um SGP que recuse sempre repete os mesmos 30.
    take: 30,
  });
  let enviadas = 0;
  for (const p of pendentes) if (await enviarAoSgp(p.id)) enviadas++;
  return enviadas;
}


/**
 * O cliente confirmou que estara em casa.
 *
 * Nao muda nada na agenda — muda o que o supervisor sabe ao montar a rota.
 * Visita confirmada e visita que provavelmente acontece; a diferenca entre as
 * duas e o deslocamento perdido.
 */
export async function confirmarPeloCliente(provedorId: string, sgpOsId: string) {
  const m = await prisma.agendamento.findUnique({
    where: { provedorId_sgpOsId: { provedorId, sgpOsId } },
    select: { id: true, status: true },
  });
  if (!m || m.status !== "marcado") return null;
  return prisma.$transaction(async (tx) => {
    const r = await tx.agendamento.update({
      where: { id: m.id },
      data: { confirmadoEm: new Date() },
      select: { id: true, dia: true, turno: true, confirmadoEm: true },
    });
    await registrarEvento(tx, { provedorId, sgpOsId, agendamentoId: r.id, tipo: "confirmado", dia: r.dia, turno: r.turno, origem: "cliente", autor: "Cliente" });
    return r;
  });
}

/**
 * Abertura de OS avisada por um parceiro (o AtendAI abriu no SGP). E so trilha: a OS chega ao
 * espelho pelo sync, como qualquer outra.
 */
export async function registrarAbertura(args: { provedorId: string; sgpOsId: string; origem: string; autor?: string | null; contexto?: ContextoEvento }) {
  await registrarEvento(prisma, { ...args, tipo: "os_aberta" });
}

/** A trilha de uma OS, mais recente primeiro. */
export async function eventosDaOs(provedorId: string, sgpOsId: string) {
  return prisma.agendamentoEvento.findMany({
    where: { provedorId, sgpOsId },
    orderBy: { criadoEm: "desc" },
    take: 100,
  });
}

/**
 * Remarca a pedido do PROPRIO cliente, com as regras de autoatendimento.
 *
 * Separada de `marcar` porque so aqui existem teto e prazo — e porque so aqui
 * a remarcacao precisa ser CONTADA. Unificar as duas faria a atendente gastar
 * o teto do cliente, que e o contrario do que o teto existe pra fazer.
 */
export async function remarcarPeloCliente(args: {
  provedorId: string;
  sgpOsId: string;
  dia: string;
  turno: TurnoAgenda;
  regiao?: string | null;
}) {
  const config = await lerConfig();
  const atual = await prisma.agendamento.findUnique({
    where: { provedorId_sgpOsId: { provedorId: args.provedorId, sgpOsId: args.sgpOsId } },
    select: { id: true, dia: true, status: true, remarcacoesCliente: true, ordemRota: true },
  });

  const recusa = podeClienteRemarcar({
    atual:
      atual && atual.status === "marcado"
        ? { dia: atual.dia.toISOString().slice(0, 10), remarcacoesCliente: atual.remarcacoesCliente }
        : null,
    hoje: diaBrDe(new Date()),
    max: config.remarcacoesMaxCliente,
  });
  if (recusa) throw recusa;

  // A rota estava montada? Entao o supervisor precisa saber que ela mudou.
  const estavaRoteirizada = atual!.ordemRota != null;

  const marcado = await marcar({
    provedorId: args.provedorId,
    sgpOsId: args.sgpOsId,
    dia: args.dia,
    turno: args.turno,
    regiao: args.regiao,
    origem: "cliente",
    marcadoPor: "Cliente",
  });

  await prisma.agendamento.update({
    where: { id: marcado.id },
    // Remarcou: a confirmacao anterior era sobre OUTRA data e nao vale mais.
    data: { remarcacoesCliente: { increment: 1 }, confirmadoEm: null },
  });

  if (estavaRoteirizada) await avisarSupervisao(marcado.id, args.dia, args.turno);
  return marcado;
}

/**
 * Avisa quem despacha que o cliente mexeu numa visita JA roteirizada.
 *
 * So nesse caso: remarcacao de visita ainda nao roteirizada nao tira o sono de
 * ninguem, e avisar de tudo faria o sino virar ruido que ninguem le.
 */
async function avisarSupervisao(agendamentoId: string, dia: string, turno: TurnoAgenda): Promise<void> {
  try {
    const m = await prisma.agendamento.findUnique({
      where: { id: agendamentoId },
      select: { sgpOsId: true, ordemServicoId: true, ordemServico: { select: { clienteNome: true } } },
    });
    const quem = m?.ordemServico?.clienteNome?.trim() || `OS #${m?.sgpOsId ?? "?"}`;
    const quando = `${dia.slice(8, 10)}/${dia.slice(5, 7)} de ${turno === "manha" ? "manha" : "tarde"}`;
    const supervisores = await prisma.usuario.findMany({
      where: { ativo: true, role: { in: ["admin", "gestor"] } },
      select: { id: true },
    });
    if (supervisores.length === 0) return;
    await prisma.notificacao.createMany({
      data: supervisores.map((u) => ({
        usuarioId: u.id,
        tipo: "agenda_remarcada",
        mensagem: `${quem} remarcou a visita para ${quando} — a rota do dia mudou.`,
        ordemServicoId: m?.ordemServicoId ?? null,
      })),
    });
  } catch (e) {
    // Aviso e complemento: falhar aqui nao pode desfazer uma remarcacao que o
    // cliente ja ouviu como confirmada.
    console.warn("[agenda] nao consegui avisar a supervisao da remarcacao:", e);
  }
}

/** Uma linha do `groupBy` de marcacoes por quem marcou. */
export interface LinhaMarcacao {
  marcadoPor: string | null;
  origem: string;
  status: string;
  total: number;
}

export interface MarcacoesPorFuncionario {
  /** Quem marcou; sem nome (ex.: bot) cai na origem — "atendai_ia", "sgp". */
  marcadoPor: string;
  origem: string;
  marcadas: number;
  canceladas: number;
}

/**
 * Soma as marcacoes por funcionario, do maior pro menor. "Marcada" conta o que
 * esta de pe; "cancelada" o que foi desmarcado depois — os dois numeros
 * importam: muita marcacao com muito cancelamento e outro problema.
 */
export function resumirMarcacoes(linhas: LinhaMarcacao[]): MarcacoesPorFuncionario[] {
  const acc = new Map<string, MarcacoesPorFuncionario>();
  for (const l of linhas) {
    const quem = l.marcadoPor?.trim() || l.origem;
    const chave = `${quem}|${l.origem}`;
    const atual = acc.get(chave) ?? { marcadoPor: quem, origem: l.origem, marcadas: 0, canceladas: 0 };
    if (l.status === "cancelado") atual.canceladas += l.total;
    else atual.marcadas += l.total;
    acc.set(chave, atual);
  }
  return [...acc.values()].sort((a, b) => b.marcadas - a.marcadas || b.canceladas - a.canceladas);
}
