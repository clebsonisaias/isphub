import { Prisma } from "@prisma/client";
import {
  avaliarDivergencia,
  chaveDiaBrasileiro,
  coberturaPct,
  consumoPorAbastecimento,
  custoPorKm,
  diasDoIntervalo,
  precoMedioLitro,
  razaoOdometroGps,
  type VereditoDivergencia,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";

/**
 * BI DA FROTA — custo, uso e o que nao bate.
 *
 * Quatro regras governam este arquivo:
 *
 * 1. **A VIAGEM e o grao, nunca a POSICAO.** `PosicaoRastreador` sao ~1.200
 *    linhas por veiculo por dia, nao carregam `veiculoId` (a atribuicao e na
 *    leitura, pelo vinculo vigente) e nao tem expurgo. Tudo aqui sai de
 *    `Viagem`, `EventoRastreador`, `Abastecimento` e `Lancamento` — poucas
 *    linhas por dia, todas indexadas por `(veiculoId, data)`. De quebra, o BI
 *    sobrevive ao expurgo de posicoes quando ele existir.
 *
 * 2. **Dinheiro soma no Postgres e trafega como string.** Nenhum `Number` toca
 *    valor monetario, pela mesma razao que `relatorioFinanceiroService`
 *    documenta: basta um `Number()` copiado daqui para um lugar onde ele
 *    importa.
 *
 * 3. **Celula vazia NUNCA vira zero.** Metade da frota nao tem rastreador, e a
 *    resposta e uma UNIAO discriminada — nao um campo opcional. O componente
 *    fica impedido de renderizar "0 km" onde a verdade e "nao sei", porque o
 *    campo nao existe naquele ramo do tipo.
 *
 * 4. **O gestor ve a METRICA, nao o razao.** Este service le `Abastecimento` e
 *    `Lancamento` e devolve AGREGADO. Nada de `lancamentoId`, `cartaoId`,
 *    `responsavelId` ou valor de abastecimento individual sai daqui: o razao
 *    contabil continua atras do `requireRole(ADMIN)` de `/financeiro`.
 */

// ---------------------------------------------------------------------------
// Tipos de saida
// ---------------------------------------------------------------------------

/**
 * O que o rastreador sabe deste veiculo no periodo — uma UNIAO, nao campos
 * opcionais.
 *
 * E a protecao mais importante da tela. Com campos opcionais, `kmGps ?? 0`
 * apareceria em algum lugar no primeiro dia, e a metade da frota que nao tem
 * rastreador passaria a "nao rodar" em vez de "nao sabemos".
 */
export type Rastreamento =
  | { tipo: "sem_rastreador" }
  | { tipo: "sem_movimento"; coberturaPct: number | null }
  | {
      tipo: "medido";
      kmGps: number;
      viagens: number;
      /** Viagens cuja distancia nao foi calculada — sem isto o total mente. */
      viagensSemDistancia: number;
      ociosoSeg: number;
      velocidadeMaxKmh: number | null;
      coberturaPct: number | null;
    };

export interface LinhaVeiculo {
  veiculoId: string;
  placa: string;
  modelo: string;
  provedorNome: string | null;
  /**
   * SO isto, e nao o estado de movimento: este endpoint nao consulta `Viagem`, e
   * afirmar "sem movimento" sem ter olhado seria inventar. Quem responde
   * movimento e cobertura e `/frota/bi/uso`.
   */
  temRastreador: boolean;
  /** Delta do odometro entre o primeiro e o ultimo abastecimento do periodo. */
  kmOdometro: number | null;
  abastecimentos: number;
  litros: string | null;
  /** Combustivel + qualquer lancamento com `veiculoId`. Sempre string. */
  gastoTotal: string;
  gastoCombustivel: string;
  /** R$/km sobre o odometro — `null` sem odometro no periodo. */
  custoPorKm: string | null;
  /** km/l pelo metodo tanque-cheio. `null` com menos de dois cheios. */
  kmPorLitro: number | null;
}

export interface BiCusto {
  de: string;
  ate: string;
  resumo: {
    veiculos: number;
    comRastreador: number;
    gastoTotal: string;
    gastoCombustivel: string;
    litros: string;
    precoMedioLitro: string | null;
  };
  veiculos: LinhaVeiculo[];
  porPosto: { posto: string; litros: string; gasto: string; precoMedio: string | null }[];
}

export interface BiUso {
  de: string;
  ate: string;
  resumo: { kmGps: number; viagens: number; ociosoSeg: number; veiculosSemUso: number };
  serie: { dia: string; kmGps: number; viagens: number }[];
  veiculos: { veiculoId: string; placa: string; rastreamento: Rastreamento }[];
  /** Excesso de velocidade por veiculo. `veiculoId` nulo entra em linha propria. */
  excessos: { veiculoId: string | null; placa: string | null; ocorrencias: number }[];
}

export interface BiAuditoria {
  de: string;
  ate: string;
  divergencias: {
    veiculoId: string;
    placa: string;
    veredito: VereditoDivergencia;
    kmOdometro: number | null;
    kmGps: number | null;
    coberturaPct: number | null;
  }[];
  /** Sinais que NAO dependem de GPS — valem para a frota inteira. */
  abastecimentoSemRodagem: { veiculoId: string; placa: string; data: string; litros: string }[];
  viagensSemOcupacao: { veiculoId: string; placa: string; viagens: number }[];
  rastreadoresMudos: { veiculoId: string | null; placa: string | null; desde: string | null }[];
}

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

const OFFLINE_MUDO_MS = 6 * 60 * 60_000;

/** Decimal do Prisma -> centavos INTEIROS. Nunca `Number` em dinheiro. */
function centavos(d: Prisma.Decimal | null | undefined): number {
  return d ? Math.round(Number(d.toFixed(2)) * 100) : 0;
}
function reais(c: number): string {
  return (c / 100).toFixed(2);
}

/**
 * O tempo em que o aparelho esteve CEGO no periodo.
 *
 * Pareia `ficou_offline` com o `voltou_online` seguinte. Um `ficou_offline` sem
 * par (o aparelho nunca voltou) fica cego ate o fim da janela — e esse e o caso
 * que mais importa, entao ele nao pode ser descartado por falta de fechamento.
 */
function minutosCegos(
  eventos: { tipo: string; em: Date }[],
  de: Date,
  ate: Date,
): number {
  let total = 0;
  let quedaEm: Date | null = null;
  for (const e of eventos) {
    if (e.tipo === "ficou_offline" && quedaEm === null) quedaEm = e.em;
    else if (e.tipo === "voltou_online" && quedaEm !== null) {
      total += (e.em.getTime() - quedaEm.getTime()) / 60_000;
      quedaEm = null;
    }
  }
  if (quedaEm !== null) total += (ate.getTime() - quedaEm.getTime()) / 60_000;
  return Math.max(0, Math.min(total, (ate.getTime() - de.getTime()) / 60_000));
}

/** Veiculos no escopo do usuario, com o vinculo de rastreador vigente. */
async function veiculosDoEscopo(escopo: Record<string, unknown>) {
  return prisma.veiculo.findMany({
    where: { ...escopo, status: { not: "inativo" } },
    orderBy: { placa: "asc" },
    select: {
      id: true,
      placa: true,
      modelo: true,
      provedor: { select: { nome: true } },
      vinculos: { where: { fimEm: null }, select: { rastreadorId: true }, take: 1 },
    },
  });
}

// ---------------------------------------------------------------------------
// CUSTO
// ---------------------------------------------------------------------------

export async function custo(escopo: Record<string, unknown>, de: Date, ate: Date): Promise<BiCusto> {
  const veiculos = await veiculosDoEscopo(escopo);
  const ids = veiculos.map((v) => v.id);

  const [abastecimentos, gastoPorVeiculo, porPostoBruto] = await Promise.all([
    prisma.abastecimento.findMany({
      where: { veiculoId: { in: ids }, data: { gte: de, lte: ate } },
      orderBy: [{ veiculoId: "asc" }, { km: "asc" }],
      select: { veiculoId: true, km: true, litros: true, valorTotal: true, tanqueCheio: true },
    }),
    /*
     * O gasto TOTAL sai de `Lancamento`, e nao da soma dos abastecimentos: o
     * abastecimento aponta para o lancamento gemeo, entao somar os dois
     * contaria combustivel duas vezes. `Lancamento.veiculoId` cobre os dois
     * caminhos — combustivel e o resto (revisao, pneu, seguro, multa).
     */
    prisma.lancamento.groupBy({
      by: ["veiculoId"],
      where: {
        veiculoId: { in: ids },
        status: { not: "cancelado" },
        competencia: { gte: de, lte: ate },
      },
      _sum: { valor: true },
    }),
    prisma.abastecimento.groupBy({
      by: ["posto"],
      where: { veiculoId: { in: ids }, data: { gte: de, lte: ate } },
      _sum: { litros: true, valorTotal: true },
    }),
  ]);

  const gastoTotalPorId = new Map(gastoPorVeiculo.map((g) => [g.veiculoId, centavos(g._sum.valor)]));

  const linhas: LinhaVeiculo[] = [];
  let somaTotal = 0;
  let somaCombustivel = 0;
  let somaLitros = 0;

  for (const v of veiculos) {
    const meus = abastecimentos.filter((a) => a.veiculoId === v.id);
    const litros = meus.reduce((s, a) => s + Number(a.litros), 0);
    const combustivel = meus.reduce((s, a) => s + centavos(a.valorTotal), 0);
    const total = gastoTotalPorId.get(v.id) ?? combustivel;

    /*
     * O odometro do periodo e o DELTA entre o primeiro e o ultimo
     * abastecimento — nao o odometro absoluto. Com menos de dois, nao ha delta:
     * `null`, e a tela diz "sem odometro no periodo".
     */
    const kmOdometro = meus.length >= 2 ? meus[meus.length - 1]!.km - meus[0]!.km : null;

    // `consumoPorAbastecimento` ja devolve `null` onde nao da pra afirmar; a
    // mediana dos nao-nulos evita reintroduzir o numero inventado que ela evita.
    const consumos = consumoPorAbastecimento(
      // `litros` como STRING: mesma regra do dinheiro, e o que a funcao espera.
      meus.map((a) => ({ km: a.km, litros: a.litros.toFixed(3), tanqueCheio: a.tanqueCheio })),
    ).filter((c): c is number => c !== null);
    const kmPorLitro = consumos.length > 0 ? consumos.reduce((s, c) => s + c, 0) / consumos.length : null;

    somaTotal += total;
    somaCombustivel += combustivel;
    somaLitros += litros;

    linhas.push({
      veiculoId: v.id,
      placa: v.placa,
      modelo: v.modelo,
      provedorNome: v.provedor?.nome ?? null,
      temRastreador: v.vinculos.length > 0,
      kmOdometro,
      abastecimentos: meus.length,
      litros: meus.length > 0 ? litros.toFixed(3) : null,
      gastoTotal: reais(total),
      gastoCombustivel: reais(combustivel),
      custoPorKm: custoPorKm(total, kmOdometro),
      kmPorLitro,
    });
  }

  return {
    de: chaveDiaBrasileiro(de),
    ate: chaveDiaBrasileiro(ate),
    resumo: {
      veiculos: veiculos.length,
      comRastreador: veiculos.filter((v) => v.vinculos.length > 0).length,
      gastoTotal: reais(somaTotal),
      gastoCombustivel: reais(somaCombustivel),
      litros: somaLitros.toFixed(3),
      precoMedioLitro: precoMedioLitro(somaCombustivel, somaLitros),
    },
    veiculos: linhas,
    porPosto: porPostoBruto
      .map((p) => {
        const c = centavos(p._sum.valorTotal);
        const l = Number(p._sum.litros ?? 0);
        return {
          // Posto nulo vira linha PROPRIA, e nao some — a mesma regra do DRE.
          posto: p.posto ?? "Sem posto informado",
          litros: l.toFixed(3),
          gasto: reais(c),
          precoMedio: precoMedioLitro(c, l),
        };
      })
      .sort((a, b) => Number(b.gasto) - Number(a.gasto)),
  };
}

// ---------------------------------------------------------------------------
// USO
// ---------------------------------------------------------------------------

export async function uso(escopo: Record<string, unknown>, de: Date, ate: Date): Promise<BiUso> {
  const veiculos = await veiculosDoEscopo(escopo);
  const ids = veiculos.map((v) => v.id);

  const [viagens, semDistancia, eventos, excessosBrutos] = await Promise.all([
    prisma.viagem.findMany({
      where: { veiculoId: { in: ids }, inicioEm: { gte: de, lte: ate } },
      select: {
        veiculoId: true,
        inicioEm: true,
        distanciaMetros: true,
        paradoComMotorLigadoSeg: true,
        velocidadeMaxKmh: true,
      },
    }),
    /*
     * `_sum` do Prisma PULA nulo em silencio: uma viagem sem distancia calculada
     * viraria 0 km no total sem nada na tela dizendo isso. Contamos a parte.
     */
    prisma.viagem.groupBy({
      by: ["veiculoId"],
      where: { veiculoId: { in: ids }, inicioEm: { gte: de, lte: ate }, distanciaMetros: null },
      _count: { _all: true },
    }),
    prisma.eventoRastreador.findMany({
      where: {
        veiculoId: { in: ids },
        tipo: { in: ["ficou_offline", "voltou_online"] },
        em: { gte: de, lte: ate },
      },
      orderBy: { em: "asc" },
      select: { veiculoId: true, tipo: true, em: true },
    }),
    prisma.eventoRastreador.groupBy({
      by: ["veiculoId"],
      where: { tipo: "excesso_velocidade", em: { gte: de, lte: ate } },
      _count: { _all: true },
    }),
  ]);

  const semDistPorId = new Map(semDistancia.map((s) => [s.veiculoId, s._count._all]));
  const placaPorId = new Map(veiculos.map((v) => [v.id, v.placa]));

  const linhas = veiculos.map((v) => {
    if (v.vinculos.length === 0) {
      return { veiculoId: v.id, placa: v.placa, rastreamento: { tipo: "sem_rastreador" } as Rastreamento };
    }
    const minhas = viagens.filter((t) => t.veiculoId === v.id);
    const cobertura = coberturaPct(
      minutosCegos(eventos.filter((e) => e.veiculoId === v.id), de, ate),
      (ate.getTime() - de.getTime()) / 60_000,
    );
    if (minhas.length === 0) {
      return {
        veiculoId: v.id,
        placa: v.placa,
        rastreamento: { tipo: "sem_movimento", coberturaPct: cobertura } as Rastreamento,
      };
    }
    return {
      veiculoId: v.id,
      placa: v.placa,
      rastreamento: {
        tipo: "medido",
        kmGps: Math.round(minhas.reduce((s, t) => s + (t.distanciaMetros ?? 0), 0) / 1000),
        viagens: minhas.length,
        viagensSemDistancia: semDistPorId.get(v.id) ?? 0,
        ociosoSeg: minhas.reduce((s, t) => s + (t.paradoComMotorLigadoSeg ?? 0), 0),
        velocidadeMaxKmh: minhas.reduce<number | null>(
          (m, t) => (t.velocidadeMaxKmh != null && (m === null || t.velocidadeMaxKmh > m) ? t.velocidadeMaxKmh : m),
          null,
        ),
        coberturaPct: cobertura,
      } as Rastreamento,
    };
  });

  /*
   * A serie inclui os dias VAZIOS. Montada so com os dias que tiveram viagem, o
   * dia em que a frota nao saiu vira um buraco no eixo — e o olho le "nao
   * medimos" onde a verdade e "nao rodou".
   *
   * Agrupada em JS por `chaveDiaBrasileiro`, e nao por `date_trunc`: com o
   * volume de hoje sao centenas de linhas, e usar SQL aqui duplicaria a regra
   * de fuso em dois lugares que discordariam tres dias por ano.
   */
  const porDia = new Map<string, { kmGps: number; viagens: number }>();
  for (const d of diasDoIntervalo(de, ate)) porDia.set(d, { kmGps: 0, viagens: 0 });
  for (const t of viagens) {
    const chave = chaveDiaBrasileiro(t.inicioEm);
    const atual = porDia.get(chave);
    if (!atual) continue;
    atual.kmGps += (t.distanciaMetros ?? 0) / 1000;
    atual.viagens += 1;
  }

  return {
    de: chaveDiaBrasileiro(de),
    ate: chaveDiaBrasileiro(ate),
    resumo: {
      kmGps: Math.round(viagens.reduce((s, t) => s + (t.distanciaMetros ?? 0), 0) / 1000),
      viagens: viagens.length,
      ociosoSeg: viagens.reduce((s, t) => s + (t.paradoComMotorLigadoSeg ?? 0), 0),
      veiculosSemUso: linhas.filter((l) => l.rastreamento.tipo === "sem_movimento").length,
    },
    serie: [...porDia.entries()].map(([dia, v]) => ({ dia, kmGps: Math.round(v.kmGps), viagens: v.viagens })),
    veiculos: linhas,
    excessos: excessosBrutos
      .map((e) => ({
        veiculoId: e.veiculoId,
        // `EventoRastreador.veiculoId` e nulavel (o veiculo pode ter sido
        // apagado). Linha propria, nunca descartado do groupBy.
        placa: e.veiculoId ? (placaPorId.get(e.veiculoId) ?? null) : null,
        ocorrencias: e._count._all,
      }))
      .filter((e) => e.veiculoId === null || placaPorId.has(e.veiculoId))
      .sort((a, b) => b.ocorrencias - a.ocorrencias),
  };
}

// ---------------------------------------------------------------------------
// AUDITORIA
// ---------------------------------------------------------------------------

export async function auditoria(escopo: Record<string, unknown>, de: Date, ate: Date): Promise<BiAuditoria> {
  const veiculos = await veiculosDoEscopo(escopo);
  const ids = veiculos.map((v) => v.id);

  const [abastecimentos, viagens, eventos, mudos, semOcupacao] = await Promise.all([
    prisma.abastecimento.findMany({
      where: { veiculoId: { in: ids }, data: { gte: de, lte: ate } },
      orderBy: [{ veiculoId: "asc" }, { km: "asc" }],
      select: { veiculoId: true, km: true, data: true, litros: true },
    }),
    prisma.viagem.findMany({
      where: { veiculoId: { in: ids }, inicioEm: { gte: de, lte: ate } },
      select: { veiculoId: true, inicioEm: true, distanciaMetros: true },
    }),
    prisma.eventoRastreador.findMany({
      where: { veiculoId: { in: ids }, tipo: { in: ["ficou_offline", "voltou_online"] }, em: { gte: de, lte: ate } },
      orderBy: { em: "asc" },
      select: { veiculoId: true, tipo: true, em: true },
    }),
    prisma.rastreador.findMany({
      where: {
        ativo: true,
        vinculos: { some: { fimEm: null, veiculoId: { in: ids } } },
        OR: [{ ultimaPosicaoEm: null }, { ultimaPosicaoEm: { lt: new Date(Date.now() - OFFLINE_MUDO_MS) } }],
      },
      select: { ultimaPosicaoEm: true, vinculos: { where: { fimEm: null }, select: { veiculoId: true }, take: 1 } },
    }),
    prisma.viagem.groupBy({
      by: ["veiculoId"],
      where: { veiculoId: { in: ids }, inicioEm: { gte: de, lte: ate }, ocupacaoId: null },
      _count: { _all: true },
    }),
  ]);

  const placaPorId = new Map(veiculos.map((v) => [v.id, v.placa]));

  /*
   * A DIVERGENCIA, por INTERVALO DE ABASTECIMENTO — e nao pelo periodo inteiro.
   *
   * O delta do odometro so existe entre dois abastecimentos; comparar esse
   * delta com o GPS do periodo TODO mede janelas diferentes e produz uma razao
   * sem sentido. (Foi o que o seed mostrou na primeira tentativa: veiculos
   * normais apareciam com razao 0,98 porque o GPS cobria dias que o odometro
   * nao cobria.)
   *
   * Cada intervalo vira uma razao; a mais recente e o que se avalia, e as
   * anteriores sao a BASE — a historia do proprio veiculo.
   */
  const divergencias: BiAuditoria["divergencias"] = [];
  for (const v of veiculos) {
    if (v.vinculos.length === 0) continue;
    const meus = abastecimentos.filter((a) => a.veiculoId === v.id);
    const cobertura = coberturaPct(
      minutosCegos(eventos.filter((e) => e.veiculoId === v.id), de, ate),
      (ate.getTime() - de.getTime()) / 60_000,
    );

    const razoes: (number | null)[] = [];
    for (let i = 1; i < meus.length; i += 1) {
      const ini = meus[i - 1]!;
      const fim = meus[i]!;
      const kmOdo = fim.km - ini.km;
      const metrosGps = viagens
        .filter((t) => t.veiculoId === v.id && t.inicioEm >= ini.data && t.inicioEm <= fim.data)
        .reduce((s, t) => s + (t.distanciaMetros ?? 0), 0);
      // Abaixo de 100 km o ruido relativo domina — a razao nao diz nada.
      razoes.push(kmOdo >= 100 ? razaoOdometroGps(kmOdo, metrosGps) : null);
    }

    const atual = razoes.length > 0 ? razoes[razoes.length - 1]! : null;
    const historico = razoes.slice(0, -1);
    const ultimoIni = meus.length >= 2 ? meus[meus.length - 2]! : null;
    const ultimoFim = meus.length >= 2 ? meus[meus.length - 1]! : null;

    divergencias.push({
      veiculoId: v.id,
      placa: v.placa,
      veredito: avaliarDivergencia({ razao: atual, cobertura, historico }),
      kmOdometro: ultimoIni && ultimoFim ? ultimoFim.km - ultimoIni.km : null,
      kmGps:
        ultimoIni && ultimoFim
          ? Math.round(
              viagens
                .filter((t) => t.veiculoId === v.id && t.inicioEm >= ultimoIni.data && t.inicioEm <= ultimoFim.data)
                .reduce((s, t) => s + (t.distanciaMetros ?? 0), 0) / 1000,
            )
          : null,
      coberturaPct: cobertura,
    });
  }

  /*
   * Abastecimento em dia SEM viagem nenhuma. Nao depende de GPS para o
   * diagnostico ser util, mas so faz sentido onde HA rastreador — sem ele,
   * "nao houve viagem" e "nao sabemos" seriam a mesma coisa.
   */
  const comRastreador = new Set(veiculos.filter((v) => v.vinculos.length > 0).map((v) => v.id));
  const diasComViagem = new Set(viagens.map((t) => `${t.veiculoId}|${chaveDiaBrasileiro(t.inicioEm)}`));
  const abastecimentoSemRodagem = abastecimentos
    .filter((a) => comRastreador.has(a.veiculoId))
    .filter((a) => !diasComViagem.has(`${a.veiculoId}|${chaveDiaBrasileiro(a.data)}`))
    .map((a) => ({
      veiculoId: a.veiculoId,
      placa: placaPorId.get(a.veiculoId) ?? "—",
      data: chaveDiaBrasileiro(a.data),
      litros: Number(a.litros).toFixed(3),
    }));

  return {
    de: chaveDiaBrasileiro(de),
    ate: chaveDiaBrasileiro(ate),
    // "revisar" primeiro, mas ordenado por PLACA dentro de cada grupo — nunca
    // por divergencia decrescente, que transformaria a tabela numa lista de
    // suspeitos independente do que o texto diga.
    divergencias: divergencias.sort((a, b) => {
      const peso = (t: string) => (t === "revisar" ? 0 : t === "dentro" ? 1 : 2);
      const d = peso(a.veredito.tipo) - peso(b.veredito.tipo);
      return d !== 0 ? d : a.placa.localeCompare(b.placa);
    }),
    abastecimentoSemRodagem,
    viagensSemOcupacao: semOcupacao
      .map((s) => ({
        veiculoId: s.veiculoId,
        placa: placaPorId.get(s.veiculoId) ?? "—",
        viagens: s._count._all,
      }))
      .sort((a, b) => b.viagens - a.viagens),
    rastreadoresMudos: mudos.map((r) => ({
      veiculoId: r.vinculos[0]?.veiculoId ?? null,
      placa: r.vinculos[0] ? (placaPorId.get(r.vinculos[0].veiculoId) ?? null) : null,
      desde: r.ultimaPosicaoEm?.toISOString() ?? null,
    })),
  };
}
