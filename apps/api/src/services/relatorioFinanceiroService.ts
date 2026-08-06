import { Prisma } from "@prisma/client";
import {
  FAIXAS_ATRASO,
  deCentavos,
  diasEntre,
  hojeIso,
  mesesEntre,
  paraCentavos,
  primeiroDiaDoMes,
  somarMeses,
  ultimoDiaDoMes,
  type ClassificacaoDre,
  type ComposicaoCategoria,
  type DreLinha,
  type DreResultado,
  type FaixaAtraso,
  type InadimplenciaProvedor,
  type InadimplenciaResultado,
  type Regime,
  type SerieMensalPonto,
  type SerieMensalResultado,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { dataCivil, somarValores } from "./lancamentoService.js";

/**
 * RELATORIOS DO FINANCEIRO DA HUBISP — DRE, inadimplencia e serie mensal.
 *
 * Tres regras governam este arquivo:
 *
 * 1. TODA soma de dinheiro acontece no Postgres (`aggregate`/`groupBy`/`SUM`)
 *    ou, quando precisa ser dobrada em JavaScript, passa por CENTAVOS INTEIROS
 *    (`somarValores`). Nenhum `Number` toca valor monetario.
 *
 * 2. Nada e agregado pela data de VENCIMENTO. O ERP de origem faz isso e por
 *    isso o DRE dele joga a mensalidade de marco que vence 10/abril dentro de
 *    abril. Aqui existem dois regimes explicitos e o usuario escolhe:
 *    competencia (o mes a que pertence) ou caixa (o mes em que o dinheiro se
 *    moveu).
 *
 * 3. O que nao tem classificacao aparece em LINHA PROPRIA. A documentacao da
 *    origem registra o defeito oposto — "despesas sem classificacao caem
 *    silenciosamente em custos variaveis" — e um DRE que esconde de onde vem o
 *    numero e pior do que nenhum.
 */

/** Lancamento cancelado nao entra em relatorio nenhum: ele deixou de existir como fato. */
const NAO_CANCELADO = { status: { not: "cancelado" as const } };

// ---------------------------------------------------------------------------
// Recorte por regime
// ---------------------------------------------------------------------------

/**
 * O `where` do periodo, que MUDA com o regime:
 *
 * - competencia: `competencia` dentro da faixa, pago ou nao — e o que o mes
 *   gerou de resultado.
 * - caixa: so o que foi BAIXADO, pela data em que foi baixado — e o que
 *   efetivamente entrou ou saiu.
 */
function whereDoPeriodo(regime: Regime, deMes: string, ateMes: string): Prisma.LancamentoWhereInput {
  if (regime === "caixa") {
    return {
      status: "pago",
      pagoEm: { gte: dataCivil(primeiroDiaDoMes(deMes)), lte: dataCivil(ultimoDiaDoMes(ateMes)) },
    };
  }
  return {
    ...NAO_CANCELADO,
    competencia: { gte: dataCivil(primeiroDiaDoMes(deMes)), lte: dataCivil(primeiroDiaDoMes(ateMes)) },
  };
}

/**
 * Qual coluna de VALOR o regime usa.
 *
 * Em caixa e `valorPago`, nao `valor`: quem pagou com juros ou desconto moveu
 * um numero diferente do previsto, e o regime de caixa mede o que se moveu.
 * Usar `valor` nos dois casos faria o caixa mentir exatamente nas linhas em que
 * ele tem algo a dizer.
 */
function colunaValor(regime: Regime): "valor" | "valorPago" {
  return regime === "caixa" ? "valorPago" : "valor";
}

async function somar(where: Prisma.LancamentoWhereInput, regime: Regime): Promise<string> {
  const campo = colunaValor(regime);
  const r = await prisma.lancamento.aggregate({ where, _sum: { [campo]: true } as never });
  const soma = (r._sum as Record<string, Prisma.Decimal | null>)[campo];
  return (soma ?? new Prisma.Decimal(0)).toFixed(2);
}

// ---------------------------------------------------------------------------
// DRE
// ---------------------------------------------------------------------------

/** Percentual sobre a receita bruta, em centavos inteiros. "12.4" ou null. */
function percentual(valor: string, receitaBruta: string): string | null {
  const base = paraCentavos(receitaBruta);
  if (base === 0) return null; // sem receita, "percentual da receita" nao significa nada
  // *1000 e divisao inteira: uma casa decimal sem passar por float.
  const milesimos = Math.round((paraCentavos(valor) * 1000) / base);
  /*
   * O sinal e montado a MAO. `Math.trunc(-0.5)` e `-0`, e `${-0}` imprime "0"
   * — entao um prejuizo de meio por cento sairia como "0.5", positivo. O sinal
   * some justamente na faixa em que ele muda o significado da linha.
   */
  const sinal = milesimos < 0 ? "-" : "";
  const abs = Math.abs(milesimos);
  return `${sinal}${Math.trunc(abs / 10)}.${abs % 10}`;
}

export interface DreArgs {
  /** "YYYY-MM" inclusivo. */
  de: string;
  ate: string;
  regime: Regime;
}

export async function dre({ de, ate, regime }: DreArgs): Promise<DreResultado> {
  const base = whereDoPeriodo(regime, de, ate);

  /*
   * A classificacao vive na CATEGORIA, e o `groupBy` do Prisma nao agrupa por
   * coluna de relacao. Entao: agrupa por categoriaId no banco (soma exata),
   * traz o mapa de categorias (tabela pequena, curada a mao) e dobra os grupos
   * por classificacao com `somarValores`, que passa por centavos inteiros.
   */
  const campo = colunaValor(regime);
  const [receitaBruta, porCategoria, categorias] = await Promise.all([
    somar({ ...base, tipo: "receita" }, regime),
    prisma.lancamento.groupBy({
      by: ["categoriaId"],
      where: { ...base, tipo: "despesa" },
      _sum: { [campo]: true } as never,
      _count: { _all: true },
    }),
    prisma.categoriaFinanceira.findMany({ select: { id: true, classificacao: true } }),
  ]);

  const classificacaoDe = new Map(categorias.map((c) => [c.id, c.classificacao]));
  const baldes: Record<ClassificacaoDre | "sem", string[]> = {
    deducao: [],
    custo_variavel: [],
    despesa_operacional: [],
    sem: [],
  };
  let quantidadeSemClassificacao = 0;

  for (const grupo of porCategoria) {
    const soma = (grupo._sum as Record<string, Prisma.Decimal | null>)[campo];
    const valor = (soma ?? new Prisma.Decimal(0)).toFixed(2);
    // Sem categoria, ou categoria ainda sem classificacao: os dois caem no
    // mesmo balde VISIVEL. Sao situacoes diferentes pro admin resolver, mas
    // identicas pro DRE — em ambas o relatorio nao sabe onde por o valor.
    const classificacao = grupo.categoriaId ? classificacaoDe.get(grupo.categoriaId) : null;
    if (classificacao) {
      baldes[classificacao].push(valor);
    } else {
      baldes.sem.push(valor);
      quantidadeSemClassificacao += grupo._count._all;
    }
  }

  const linhas = montarLinhasDre({
    receitaBruta,
    deducoes: somarValores(baldes.deducao),
    custosVariaveis: somarValores(baldes.custo_variavel),
    despesasOperacionais: somarValores(baldes.despesa_operacional),
    semClassificacao: somarValores(baldes.sem),
  });

  return {
    regime,
    de,
    ate,
    linhas,
    semClassificacao: somarValores(baldes.sem),
    quantidadeSemClassificacao,
  };
}

export interface TotaisDre {
  receitaBruta: string;
  deducoes: string;
  custosVariaveis: string;
  despesasOperacionais: string;
  semClassificacao: string;
}

/**
 * A ARITMETICA do DRE, isolada do banco.
 *
 * Fica separada porque e a parte que pode estar errada em silencio: o banco ou
 * devolve a soma certa ou nao devolve nada, mas um encadeamento errado de
 * subtracoes produz um demonstrativo que fecha e mente. Aqui da pra exercitar
 * cada degrau com numero na mao.
 */
export function montarLinhasDre(t: TotaisDre): DreLinha[] {
  // Subtracao em CENTAVOS INTEIROS — o unico jeito de o resultado fechar.
  const c = paraCentavos;
  const receitaLiquida = deCentavos(c(t.receitaBruta) - c(t.deducoes));
  const lucroBruto = deCentavos(c(receitaLiquida) - c(t.custosVariaveis));
  const resultado = deCentavos(
    c(lucroBruto) - c(t.despesasOperacionais) - c(t.semClassificacao),
  );

  const linha = (
    chave: string,
    rotulo: string,
    valor: string,
    operacao: DreLinha["operacao"],
    alerta = false,
  ): DreLinha => ({
    chave,
    rotulo,
    valor,
    operacao,
    percentualDaReceita: percentual(valor, t.receitaBruta),
    ...(alerta ? { alerta: true } : {}),
  });

  const linhas: DreLinha[] = [
    linha("receita_bruta", "Receita bruta", t.receitaBruta, "soma"),
    linha("deducoes", "(−) Deduções", t.deducoes, "subtrai"),
    linha("receita_liquida", "= Receita líquida", receitaLiquida, "total"),
    linha("custos_variaveis", "(−) Custos variáveis", t.custosVariaveis, "subtrai"),
    linha("lucro_bruto", "= Lucro bruto", lucroBruto, "total"),
    linha("despesas_operacionais", "(−) Despesas operacionais", t.despesasOperacionais, "subtrai"),
  ];

  /*
   * A linha do nao-classificado so aparece quando EXISTE — mas quando existe,
   * ela aparece antes do resultado e e descontada dele.
   *
   * Este e o ponto exato em que este DRE diverge do de origem. La, despesa sem
   * classificacao e dobrada em "custos variaveis" sem aviso; o demonstrativo
   * fecha e ninguem descobre que uma parte do numero foi chutada. Aqui ela fica
   * visivel e marcada — feio de proposito, ate alguem classificar a categoria.
   */
  if (paraCentavos(t.semClassificacao) !== 0) {
    linhas.push(linha("sem_classificacao", "(−) Sem classificação", t.semClassificacao, "subtrai", true));
  }

  linhas.push(linha("resultado", "= Resultado operacional", resultado, "total"));
  return linhas;
}

// ---------------------------------------------------------------------------
// Inadimplencia
// ---------------------------------------------------------------------------

/**
 * Inadimplencia e o que PROVEDOR deve a hub e ja venceu — so `tipo=receita`.
 *
 * Despesa da hub vencida tambem existe, mas e atraso NOSSO, nao inadimplencia
 * de ninguem; ela ja aparece como "vencido a pagar" no resumo da lista.
 * Misturar as duas num numero so foi tentador e seria mentira.
 */
export async function inadimplencia(hoje: string = hojeIso()): Promise<InadimplenciaResultado> {
  const baseVencido: Prisma.LancamentoWhereInput = {
    tipo: "receita",
    status: "pendente",
    vencimento: { lt: dataCivil(hoje) },
  };

  /*
   * Uma consulta POR FAIXA, agrupada por provedor. Cada faixa e uma janela de
   * datas fechada, entao o balde sai pronto do banco — nada de trazer as linhas
   * e classificar em JavaScript, que so seria exato enquanto coubessem na
   * memoria.
   */
  const consultasPorFaixa = FAIXAS_ATRASO.map((faixa) => {
    // Atraso de N dias = venceu ha N dias. A faixa "1 a 30" e, em datas,
    // [hoje-30, hoje-1] — o limite MAIOR de dias vira a data MENOR.
    const vencimento: Prisma.DateTimeFilter = {
      lte: dataCivil(deslocarDias(hoje, -faixa.min)),
    };
    if (faixa.max !== null) vencimento.gte = dataCivil(deslocarDias(hoje, -faixa.max));

    return prisma.lancamento.groupBy({
      by: ["provedorId"],
      where: { ...baseVencido, vencimento },
      _sum: { valor: true },
      _count: { _all: true },
    });
  });

  const [porFaixaGrupos, geral, provedores] = await Promise.all([
    Promise.all(consultasPorFaixa),
    prisma.lancamento.groupBy({
      by: ["provedorId"],
      where: baseVencido,
      _sum: { valor: true },
      _count: { _all: true },
      // O vencimento mais ANTIGO do provedor — e o que diz a gravidade.
      // Dois provedores devendo o mesmo valor nao sao o mesmo problema se um
      // atrasou 5 dias e o outro 200.
      _min: { vencimento: true },
    }),
    prisma.provedor.findMany({ select: { id: true, nome: true, cor: true } }),
  ]);

  const nomeDe = new Map(provedores.map((p) => [p.id, p]));
  const vazio = (): Record<FaixaAtraso, string> =>
    Object.fromEntries(FAIXAS_ATRASO.map((f) => [f.chave, "0.00"])) as Record<FaixaAtraso, string>;

  const porProvedor: InadimplenciaProvedor[] = geral.map((g) => {
    const p = g.provedorId ? nomeDe.get(g.provedorId) : undefined;
    const faixas = vazio();
    FAIXAS_ATRASO.forEach((faixa, i) => {
      const achado = porFaixaGrupos[i].find((x) => x.provedorId === g.provedorId);
      if (achado?._sum.valor) faixas[faixa.chave] = achado._sum.valor.toFixed(2);
    });
    const maisAntigo = g._min.vencimento;
    return {
      provedorId: g.provedorId,
      // Receita sem provedor existe (a hub pode ter outra fonte); ela nao pode
      // sumir do relatorio so por nao ter contraparte cadastrada.
      provedorNome: p?.nome ?? "Sem provedor",
      provedorCor: p?.cor ?? null,
      total: (g._sum.valor ?? new Prisma.Decimal(0)).toFixed(2),
      quantidade: g._count._all,
      diasAtrasoMaximo: maisAntigo ? diasEntre(maisAntigo.toISOString().slice(0, 10), hoje) : 0,
      porFaixa: faixas,
    };
  });

  // Maior devedor primeiro — a lista existe pra decidir quem cobrar hoje.
  porProvedor.sort((a, b) => paraCentavos(b.total) - paraCentavos(a.total));

  const totalPorFaixa = vazio();
  FAIXAS_ATRASO.forEach((faixa, i) => {
    totalPorFaixa[faixa.chave] = somarValores(
      porFaixaGrupos[i].map((g) => (g._sum.valor ?? new Prisma.Decimal(0)).toFixed(2)),
    );
  });

  return {
    total: somarValores(porProvedor.map((p) => p.total)),
    quantidade: porProvedor.reduce((acc, p) => acc + p.quantidade, 0),
    porProvedor,
    porFaixa: totalPorFaixa,
  };
}

/** "2026-08-05" deslocada em N dias, ainda como data civil. */
function deslocarDias(iso: string, dias: number): string {
  // Meio-dia UTC: a folga de 12h pra cada lado impede que o deslocamento caia
  // no dia errado atravessando horario de verao.
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Serie mensal
// ---------------------------------------------------------------------------

export interface SerieArgs {
  de: string;
  ate: string;
  regime: Regime;
}

/**
 * Receita x despesa mes a mes.
 *
 * Usa SQL cru porque precisa de `date_trunc` pra agrupar `pagoEm` (que cai em
 * qualquer dia) por mes — o `groupBy` do Prisma agruparia por dia. A montagem e
 * feita com `Prisma.sql`, e o unico trecho variavel sao NOMES DE COLUNA
 * escolhidos por um `switch` sobre um enum ja validado: nenhum texto vindo da
 * requisicao entra na consulta. Vale dizer explicitamente porque a divida de
 * seguranca numero 1 do ERP de origem e exatamente uma RPC que monta SQL
 * concatenando string.
 */
export async function serieMensal({ de, ate, regime }: SerieArgs): Promise<SerieMensalResultado> {
  const colData = regime === "caixa" ? Prisma.sql`"pagoEm"` : Prisma.sql`"competencia"`;
  const colValor = regime === "caixa" ? Prisma.sql`"valorPago"` : Prisma.sql`"valor"`;
  const filtroStatus =
    regime === "caixa" ? Prisma.sql`status = 'pago'::"LancamentoStatus"` : Prisma.sql`status <> 'cancelado'::"LancamentoStatus"`;

  const linhas = await prisma.$queryRaw<{ mes: string; tipo: string; total: string }[]>`
    SELECT to_char(date_trunc('month', ${colData}), 'YYYY-MM') AS mes,
           tipo::text AS tipo,
           COALESCE(SUM(${colValor}), 0)::text AS total
      FROM lancamentos
     WHERE ${filtroStatus}
       AND ${colData} >= ${dataCivil(primeiroDiaDoMes(de))}::date
       AND ${colData} <= ${dataCivil(ultimoDiaDoMes(ate))}::date
     GROUP BY 1, 2
  `;

  const porMes = new Map<string, { receita: string; despesa: string }>();
  for (const l of linhas) {
    const atual = porMes.get(l.mes) ?? { receita: "0.00", despesa: "0.00" };
    // `::text` de um numeric traz "1234.5" quando a escala permite; normaliza
    // pra duas casas, que e a forma canonica de dinheiro no sistema.
    const valor = deCentavos(paraCentavos(Number(l.total).toFixed(2)));
    if (l.tipo === "receita") atual.receita = valor;
    else atual.despesa = valor;
    porMes.set(l.mes, atual);
  }

  // Meses SEM movimento entram com zero. Sem isto o grafico pula o mes vazio e
  // desenha uma linha do tempo que nao existe — dezembro encostando em fevereiro.
  const pontos: SerieMensalPonto[] = mesesEntre(de, ate).map((mes) => {
    const v = porMes.get(mes) ?? { receita: "0.00", despesa: "0.00" };
    return {
      mes,
      receita: v.receita,
      despesa: v.despesa,
      resultado: deCentavos(paraCentavos(v.receita) - paraCentavos(v.despesa)),
    };
  });

  return { regime, pontos };
}

/** Os ultimos N meses terminando no mes corrente — o recorte padrao da tela. */
export function ultimosMeses(n: number, hoje: string = hojeIso()): { de: string; ate: string } {
  const ate = hoje.slice(0, 7);
  return { de: somarMeses(ate, -(n - 1)), ate };
}

// ---------------------------------------------------------------------------
// Composicao da despesa por categoria
// ---------------------------------------------------------------------------

export async function composicaoDespesa({ de, ate, regime }: SerieArgs): Promise<ComposicaoCategoria[]> {
  const campo = colunaValor(regime);
  const [grupos, categorias] = await Promise.all([
    prisma.lancamento.groupBy({
      by: ["categoriaId"],
      where: { ...whereDoPeriodo(regime, de, ate), tipo: "despesa" },
      _sum: { [campo]: true } as never,
    }),
    prisma.categoriaFinanceira.findMany({ select: { id: true, nome: true, cor: true, classificacao: true } }),
  ]);

  const porId = new Map(categorias.map((c) => [c.id, c]));
  const itens: ComposicaoCategoria[] = grupos.map((g) => {
    const cat = g.categoriaId ? porId.get(g.categoriaId) : undefined;
    const soma = (g._sum as Record<string, Prisma.Decimal | null>)[campo];
    return {
      categoriaId: g.categoriaId,
      nome: cat?.nome ?? "Sem categoria",
      cor: cat?.cor ?? "#94a3b8",
      classificacao: cat?.classificacao ?? null,
      valor: (soma ?? new Prisma.Decimal(0)).toFixed(2),
    };
  });

  return itens
    .filter((i) => paraCentavos(i.valor) !== 0)
    .sort((a, b) => paraCentavos(b.valor) - paraCentavos(a.valor));
}
