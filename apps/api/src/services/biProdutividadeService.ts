import { OsStatus } from "@prisma/client";
import {
  chaveDiaBrasileiro,
  classificarExpediente,
  diasDoIntervalo,
  duracaoOsMin,
  mediana,
  pesoDoTipo,
  pontuar,
  type Acompanhamento,
  type BiProdutividade,
  type ComoFechou,
  type ConcluidaDoTecnico,
  type Expediente,
  type LinhaTecnico,
  type PesoTipo,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";

/**
 * BI DE PRODUTIVIDADE — quem fechou o que, e como.
 *
 * Cinco decisoes governam este arquivo. As tres primeiras sao sobre JUSTICA, e
 * so existem porque o resultado fica ao lado do nome de uma pessoa:
 *
 * 1. **O credito vai pro TECNICO ATRIBUIDO, nao pra quem apertou o botao.**
 *    Quando um gestor fecha a OS pelo painel, o `autorId` do evento e dele — e
 *    creditar o gestor apagaria o tecnico que passou a tarde na casa do
 *    cliente. O autor nao e descartado: ele vira COMO a OS fechou (ela mesma,
 *    um colega, ou o SGP), que e outra coluna.
 *
 * 2. **Nada e contagem crua.** Ver `packages/shared/src/produtividade.ts`: a
 *    unidade e o ponto, e o peso de cada tipo sai da mediana de duracao da
 *    propria operacao.
 *
 * 3. **Todo "nao sabemos" e uma UNIAO, nunca um zero.** Sem viatura declarada
 *    nao e "trabalhou sozinho"; sem jornada registrada nao e "fora do
 *    expediente". Colapsar esses casos acusaria gente por lacuna de dado.
 *
 * E duas sobre de onde o numero vem:
 *
 * 4. **A fonte do fechamento e `OsEvento.statusPara`, coluna e nao frase.** Ate
 *    a migracao `20260809180000` isso era um `LIKE` na descricao em portugues.
 *
 * 5. **A janela e o dia BRASILEIRO.** O servidor roda em UTC; agrupar por dia
 *    UTC empurraria todo fechamento entre 21h e a meia-noite pro dia seguinte,
 *    e "quantas OS fecharam hoje" e a primeira pergunta da tela.
 */

// ---------------------------------------------------------------------------

const SEM_TIPO = "__sem_tipo__";

/**
 * O periodo cobre quantos dias, no maximo, antes de a consulta virar problema.
 * Nao e recorte silencioso: a rota valida e recusa alem disso.
 */
export const MAXIMO_DIAS = 400;

export async function produtividade(
  escopoOs: Record<string, unknown>,
  de: Date,
  ate: Date,
): Promise<BiProdutividade> {
  /*
   * UM select para os fechamentos e outro para os "a caminho" das MESMAS OS.
   * Nao da pra pedir os dois numa consulta so porque a duracao cruza duas
   * linhas da mesma tabela; e nao vale um `$queryRaw` com self-join, porque o
   * volume aqui e de dezenas por dia, nao de milhares.
   */
  const fechamentos = await prisma.osEvento.findMany({
    where: {
      statusPara: OsStatus.concluida,
      criadoEm: { gte: de, lte: ate },
      ordemServico: escopoOs,
    },
    select: {
      autorId: true,
      criadoEm: true,
      ordemServicoId: true,
      ordemServico: {
        select: {
          tecnicoId: true,
          tipoOsId: true,
          tecnico: { select: { id: true, nome: true } },
          tipoOs: { select: { descricao: true, categoria: { select: { nome: true } } } },
        },
      },
    },
  });

  const osIds = fechamentos.map((f) => f.ordemServicoId);

  /*
   * O inicio do trabalho e o PRIMEIRO "a caminho" da OS, e nao a abertura dela:
   * entre abrir e despachar pode haver dias de fila, e fila nao e trabalho de
   * tecnico. Medir da abertura puniria justamente quem pega a OS mais velha.
   *
   * Sem teto de data: o "a caminho" pode ser de antes do periodo — uma OS
   * comecada ontem e fechada hoje continua sendo uma OS de hoje.
   */
  const partidas = osIds.length
    ? await prisma.osEvento.findMany({
        where: { ordemServicoId: { in: osIds }, statusPara: OsStatus.em_deslocamento },
        select: { ordemServicoId: true, criadoEm: true },
        orderBy: { criadoEm: "asc" },
      })
    : [];

  const partidaDe = new Map<string, Date>();
  for (const p of partidas) {
    if (!partidaDe.has(p.ordemServicoId)) partidaDe.set(p.ordemServicoId, p.criadoEm);
  }

  // --- pesos: a mediana de cada tipo contra a mediana geral -----------------
  const duracoes = fechamentos.map((f) => ({
    tipo: f.ordemServico.tipoOsId ?? SEM_TIPO,
    nome:
      f.ordemServico.tipoOs?.descricao ??
      f.ordemServico.tipoOs?.categoria?.nome ??
      "Sem tipo informado",
    min: duracaoOsMin(partidaDe.get(f.ordemServicoId) ?? null, f.criadoEm),
  }));

  const medianaGeralMin = mediana(
    duracoes.map((d) => d.min),
    1,
  );

  const porTipo = new Map<string, { nome: string; min: (number | null)[] }>();
  for (const d of duracoes) {
    const atual = porTipo.get(d.tipo) ?? { nome: d.nome, min: [] };
    atual.min.push(d.min);
    porTipo.set(d.tipo, atual);
  }

  const pesos: PesoTipo[] = [...porTipo.entries()]
    .map(([tipoOsId, v]) => ({
      tipoOsId: tipoOsId === SEM_TIPO ? null : tipoOsId,
      nome: v.nome,
      peso: pesoDoTipo(v.min, medianaGeralMin),
      amostras: v.min.filter((m) => m !== null).length,
      medianaMin: mediana(v.min, 1),
    }))
    .sort((a, b) => (b.peso ?? 0) - (a.peso ?? 0));

  const pesoPorTipo = new Map(pesos.map((p) => [p.tipoOsId ?? SEM_TIPO, p.peso]));

  // --- contexto: quem estava em jornada, e quem estava no carro -------------
  const tecnicoIds = [...new Set(fechamentos.map((f) => f.ordemServico.tecnicoId).filter((x): x is string => !!x))];

  const jornadas = tecnicoIds.length
    ? await prisma.jornadaTecnico.findMany({
        where: {
          usuarioId: { in: tecnicoIds },
          // Uma jornada aberta ANTES do periodo ainda cobre fechamentos dentro
          // dele — filtrar so por `inicioEm >= de` perderia o turno da virada.
          OR: [{ fimEm: null }, { fimEm: { gte: de } }],
          inicioEm: { lte: ate },
        },
        select: { usuarioId: true, inicioEm: true, fimEm: true },
      })
    : [];

  const ocupacoes = tecnicoIds.length
    ? await prisma.ocupacaoVeiculo.findMany({
        where: {
          usuarioId: { in: tecnicoIds },
          OR: [{ fimEm: null }, { fimEm: { gte: de } }],
          inicioEm: { lte: ate },
        },
        select: { usuarioId: true, veiculoId: true, inicioEm: true, fimEm: true },
      })
    : [];

  /*
   * TODAS as ocupacoes dos veiculos envolvidos, e nao so as do tecnico: pra
   * responder "havia alguem junto?" e preciso ver quem MAIS estava no mesmo
   * carro no mesmo instante — inclusive gente que nao fechou OS nenhuma.
   */
  const veiculoIds = [...new Set(ocupacoes.map((o) => o.veiculoId))];
  const ocupacoesDoVeiculo = veiculoIds.length
    ? await prisma.ocupacaoVeiculo.findMany({
        where: {
          veiculoId: { in: veiculoIds },
          OR: [{ fimEm: null }, { fimEm: { gte: de } }],
          inicioEm: { lte: ate },
        },
        select: { usuarioId: true, veiculoId: true, inicioEm: true, fimEm: true },
      })
    : [];

  /** Intervalo SEMIABERTO `[inicio, fim)` — como todo intervalo do projeto. */
  function cobre(j: { inicioEm: Date; fimEm: Date | null }, instante: Date): boolean {
    return instante >= j.inicioEm && (j.fimEm === null || instante < j.fimEm);
  }

  function acompanhamentoEm(usuarioId: string, instante: Date): Acompanhamento {
    const minha = ocupacoes.find((o) => o.usuarioId === usuarioId && cobre(o, instante));
    if (!minha) return { tipo: "sem_declaracao" };
    const colegas = ocupacoesDoVeiculo.filter(
      (o) => o.veiculoId === minha.veiculoId && o.usuarioId !== usuarioId && cobre(o, instante),
    ).length;
    return colegas > 0 ? { tipo: "acompanhado", colegas } : { tipo: "sozinho" };
  }

  // --- agrega por tecnico ---------------------------------------------------
  interface Acumulador {
    nome: string;
    concluidas: ConcluidaDoTecnico[];
    comoFechou: ComoFechou;
    acompanhamento: Record<Acompanhamento["tipo"], number>;
    expediente: Record<Expediente["tipo"], number>;
    duracoes: (number | null)[];
  }

  const SEM_TECNICO = "__sem_tecnico__";
  const porTecnico = new Map<string, Acumulador>();

  for (const f of fechamentos) {
    const tecnicoId = f.ordemServico.tecnicoId;
    const chave = tecnicoId ?? SEM_TECNICO;
    const acc =
      porTecnico.get(chave) ??
      ({
        // A linha sem tecnico NAO some: uma OS que fechou sem ninguem atribuido
        // e um furo de despacho, e escondê-la faria os totais nao fecharem.
        nome: f.ordemServico.tecnico?.nome ?? "Sem técnico atribuído",
        concluidas: [],
        comoFechou: { eleMesmo: 0, outroUsuario: 0, peloSgp: 0 },
        acompanhamento: { sem_declaracao: 0, sozinho: 0, acompanhado: 0 },
        expediente: { dentro: 0, fora: 0, nao_registrou: 0 },
        duracoes: [],
      } satisfies Acumulador);

    acc.concluidas.push({
      tipoOsId: f.ordemServico.tipoOsId,
      peso: pesoPorTipo.get(f.ordemServico.tipoOsId ?? SEM_TIPO) ?? null,
      peloApp: f.autorId !== null,
    });

    if (f.autorId === null) acc.comoFechou.peloSgp += 1;
    else if (f.autorId === tecnicoId) acc.comoFechou.eleMesmo += 1;
    else acc.comoFechou.outroUsuario += 1;

    if (tecnicoId) {
      acc.acompanhamento[acompanhamentoEm(tecnicoId, f.criadoEm).tipo] += 1;
      const minhas = jornadas.filter((j) => j.usuarioId === tecnicoId);
      acc.expediente[classificarExpediente(f.criadoEm, minhas).tipo] += 1;
    } else {
      // Sem tecnico nao ha jornada nem viatura de quem perguntar.
      acc.acompanhamento.sem_declaracao += 1;
      acc.expediente.nao_registrou += 1;
    }

    acc.duracoes.push(duracaoOsMin(partidaDe.get(f.ordemServicoId) ?? null, f.criadoEm));
    porTecnico.set(chave, acc);
  }

  const tecnicos: LinhaTecnico[] = [...porTecnico.entries()]
    .map(([chave, acc]) => ({
      usuarioId: chave === SEM_TECNICO ? null : chave,
      nome: acc.nome,
      pontuacao: pontuar(acc.concluidas),
      comoFechou: acc.comoFechou,
      acompanhamento: acc.acompanhamento,
      expediente: acc.expediente,
      duracaoMedianaMin: mediana(acc.duracoes, 1),
    }))
    .sort((a, b) => b.pontuacao.pontos - a.pontuacao.pontos);

  // --- serie diaria ---------------------------------------------------------
  const porDia = new Map<string, { concluidas: number; pontos: number }>();
  for (const d of diasDoIntervalo(de, ate, MAXIMO_DIAS)) porDia.set(d, { concluidas: 0, pontos: 0 });
  for (const f of fechamentos) {
    const chave = chaveDiaBrasileiro(f.criadoEm);
    const atual = porDia.get(chave);
    if (!atual) continue;
    atual.concluidas += 1;
    atual.pontos += pesoPorTipo.get(f.ordemServico.tipoOsId ?? SEM_TIPO) ?? 1;
  }

  const pontosTotal = tecnicos.reduce((s, t) => s + t.pontuacao.pontos, 0);

  return {
    de: chaveDiaBrasileiro(de),
    ate: chaveDiaBrasileiro(ate),
    resumo: {
      concluidas: fechamentos.length,
      pontos: Math.round(pontosTotal * 10) / 10,
      tecnicosAtivos: tecnicos.filter((t) => t.usuarioId !== null).length,
      medianaGeralMin: medianaGeralMin === null ? null : Math.round(medianaGeralMin),
      calibrado: pesos.length > 0 && pesos.every((p) => p.peso !== null),
    },
    serie: [...porDia.entries()].map(([dia, v]) => ({
      dia,
      concluidas: v.concluidas,
      pontos: Math.round(v.pontos * 10) / 10,
    })),
    tecnicos,
    pesos,
  };
}
