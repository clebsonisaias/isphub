import { Prisma } from "@prisma/client";
import {
  competenciaDe,
  deCentavos,
  hojeIso,
  normalizarValor,
  paraCentavos,
  situacaoDe,
  type FinanceiroResumo,
  type LancamentoEventoPublic,
  type LancamentoPublic,
  type LancamentoSituacao,
  type LancamentoStatus,
  type OrigemLancamento,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";

/**
 * FINANCEIRO DA HUBISP — regras de lancamento e baixa.
 *
 * Duas invariantes governam este arquivo inteiro:
 *
 * 1. DINHEIRO NUNCA VIRA `number`. O `Decimal` do Prisma sai daqui como string
 *    (`toFixed(2)`), e quando ha soma em JavaScript ela acontece em CENTAVOS
 *    inteiros. `Number("0.1") + Number("0.2")` = 0.30000000000000004; foi
 *    exatamente esse tipo de aritmetica, espalhada por 20 arquivos, que fez o
 *    ERP de origem nao fechar centavos.
 *
 * 2. DATA CIVIL NUNCA VIRA `Date` local. `vencimento`/`competencia`/`pagoEm`
 *    sao @db.Date e circulam como "YYYY-MM-DD". Um `new Date("2026-02-23")` e
 *    meia-noite UTC, que em BRT (-3) e dia 22 — o bug de "um dia a menos" que
 *    a origem documentou e nunca terminou de corrigir. Aqui a unica conversao
 *    permitida esta em `dataCivil`, que ancora ao MEIO-DIA UTC: com folga de
 *    12h pra cada lado, nenhum fuso do planeta muda o dia.
 */

// ---------------------------------------------------------------------------
// Datas civis
// ---------------------------------------------------------------------------

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "YYYY-MM-DD" -> Date ancorado ao meio-dia UTC, pro Postgres gravar em
 * `date` exatamente o dia que veio escrito.
 */
export function dataCivil(iso: string, campo = "data"): Date {
  if (!RE_DATA.test(iso)) {
    throw new HttpError(400, `Campo ${campo} deve estar no formato AAAA-MM-DD`);
  }
  const d = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(400, `Campo ${campo} nao e uma data valida`);
  }
  // Rejeita 31/02 e afins: o construtor "corrige" em silencio pra 03/03, e um
  // vencimento que anda sozinho e pior do que um vencimento recusado.
  if (d.toISOString().slice(0, 10) !== iso) {
    throw new HttpError(400, `Campo ${campo} nao e uma data valida`);
  }
  return d;
}

/** Date do banco -> "YYYY-MM-DD". Le em UTC, que e como foi gravado. */
export function isoDeData(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------------

/** `Decimal` do Prisma -> string canonica "1234.56". */
export function moeda(valor: Prisma.Decimal | null): string | null {
  return valor === null ? null : valor.toFixed(2);
}

/**
 * Soma uma lista de valores monetarios em string, exata.
 * Passa por centavos inteiros de proposito — ver invariante 1 no topo.
 */
export function somarValores(valores: string[]): string {
  return deCentavos(valores.reduce((acc, v) => acc + paraCentavos(v), 0));
}

/** Valida e normaliza o valor que chegou da requisicao. */
export function exigirValor(entrada: string, campo = "valor"): string {
  const normalizado = normalizarValor(entrada);
  if (normalizado === null) {
    throw new HttpError(400, `Campo ${campo} invalido: informe um valor maior que zero`);
  }
  return normalizado;
}

// ---------------------------------------------------------------------------
// Transicoes de status
// ---------------------------------------------------------------------------

/**
 * Quais transicoes existem. Nada sai de `cancelado` e nada sai de `pago` a nao
 * ser por estorno — que e uma transicao NOMEADA, nao um update de campo, pra
 * que o evento de auditoria seja obrigatorio.
 */
const TRANSICOES: Record<LancamentoStatus, LancamentoStatus[]> = {
  pendente: ["pago", "cancelado"],
  pago: ["pendente"], // estorno
  cancelado: [], // terminal: cancelado nao volta (crie outro lancamento)
};

export function podeTransicionar(de: LancamentoStatus, para: LancamentoStatus): boolean {
  return TRANSICOES[de].includes(para);
}

export function exigirTransicao(de: LancamentoStatus, para: LancamentoStatus, acao: string): void {
  if (!podeTransicionar(de, para)) {
    throw new HttpError(409, `Nao da pra ${acao}: o lancamento esta ${de}`);
  }
}

// ---------------------------------------------------------------------------
// Serializacao
// ---------------------------------------------------------------------------

/**
 * SELECT unico da listagem e do detalhe. `comprovanteDados` fica de FORA de
 * proposito: sao bytes crus, e trazer o PDF de cada comprovante numa lista de
 * 200 lancamentos e o tipo de select que so aparece em producao. `!= null` no
 * mapeamento resolve "tem comprovante?" sem carregar nada — mesmo motivo do
 * `temFoto` denormalizado em Usuario.
 */
export const LANCAMENTO_SELECT = {
  id: true,
  numero: true,
  tipo: true,
  status: true,
  descricao: true,
  valor: true,
  vencimento: true,
  competencia: true,
  pagoEm: true,
  valorPago: true,
  formaPagamento: true,
  provedorId: true,
  categoriaId: true,
  observacao: true,
  numeroDocumento: true,
  ehServico: true,
  recorrenciaId: true,
  parcelamentoId: true,
  recorrencia: { select: { tipoProvisao: true } },
  comprovanteMime: true,
  comprovanteNome: true,
  criadoEm: true,
  provedor: { select: { nome: true, cor: true } },
  categoria: { select: { nome: true, cor: true } },
  criadoPor: { select: { nome: true } },
} satisfies Prisma.LancamentoSelect;

type LancamentoRow = Prisma.LancamentoGetPayload<{ select: typeof LANCAMENTO_SELECT }>;

/**
 * De onde a linha veio, DERIVADO dos vinculos.
 *
 * Nao e coluna de proposito: gravar "origem" ao lado das FKs criaria duas
 * verdades sobre o mesmo fato, e a que diverge sempre e a denormalizada.
 */
export function origemDe(row: {
  recorrenciaId: string | null;
  parcelamentoId: string | null;
  recorrencia: { tipoProvisao: unknown } | null;
}): OrigemLancamento {
  if (row.parcelamentoId) return "parcelado";
  if (row.recorrenciaId) return row.recorrencia?.tipoProvisao ? "provisao" : "recorrente";
  return "avulso";
}

export function toPublic(row: LancamentoRow, hoje: string = hojeIso()): LancamentoPublic {
  const vencimento = isoDeData(row.vencimento)!;
  return {
    id: row.id,
    numero: row.numero,
    tipo: row.tipo,
    status: row.status,
    situacao: situacaoDe(row.status, vencimento, hoje),
    descricao: row.descricao,
    valor: moeda(row.valor)!,
    vencimento,
    competencia: isoDeData(row.competencia)!,
    pagoEm: isoDeData(row.pagoEm),
    valorPago: moeda(row.valorPago),
    formaPagamento: row.formaPagamento,
    provedorId: row.provedorId,
    provedorNome: row.provedor?.nome ?? null,
    provedorCor: row.provedor?.cor ?? null,
    categoriaId: row.categoriaId,
    categoriaNome: row.categoria?.nome ?? null,
    categoriaCor: row.categoria?.cor ?? null,
    observacao: row.observacao,
    numeroDocumento: row.numeroDocumento,
    ehServico: row.ehServico,
    origem: origemDe(row),
    // Sem carregar os bytes: o mime so existe quando ha comprovante.
    temComprovante: row.comprovanteMime !== null,
    comprovanteNome: row.comprovanteNome,
    criadoPorNome: row.criadoPor?.nome ?? null,
    criadoEm: row.criadoEm.toISOString(),
  };
}

export function eventoToPublic(row: {
  id: string;
  tipo: LancamentoEventoPublic["tipo"];
  detalhe: Prisma.JsonValue;
  criadoEm: Date;
  autor: { nome: string } | null;
}): LancamentoEventoPublic {
  return {
    id: row.id,
    tipo: row.tipo,
    autorNome: row.autor?.nome ?? null,
    detalhe: (row.detalhe as Record<string, unknown> | null) ?? null,
    criadoEm: row.criadoEm.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Filtro -> where
// ---------------------------------------------------------------------------

export interface FiltroInterno {
  tipo?: "receita" | "despesa";
  situacao?: LancamentoSituacao;
  provedorId?: string;
  categoriaId?: string;
  de?: string;
  ate?: string;
  busca?: string;
  origem?: OrigemLancamento;
  servico?: boolean;
}

/**
 * Traduz o filtro em `where`. O ponto sutil e a situacao "atrasado", que NAO
 * e uma coluna: vira `status = pendente AND vencimento < hoje` — exatamente o
 * que o indice [status, vencimento] cobre. E o preco de derivar em vez de
 * gravar, e ele e zero.
 */
export function montarWhere(f: FiltroInterno, hoje: string = hojeIso()): Prisma.LancamentoWhereInput {
  const where: Prisma.LancamentoWhereInput = {};

  if (f.tipo) where.tipo = f.tipo;
  if (f.provedorId) where.provedorId = f.provedorId;
  if (f.categoriaId) where.categoriaId = f.categoriaId;

  if (f.situacao === "atrasado") {
    where.status = "pendente";
    where.vencimento = { lt: dataCivil(hoje) };
  } else if (f.situacao) {
    where.status = f.situacao;
  }

  if (f.de || f.ate) {
    const faixa: Prisma.DateTimeFilter = {};
    if (f.de) faixa.gte = dataCivil(f.de, "de");
    if (f.ate) faixa.lte = dataCivil(f.ate, "ate");
    // Se `situacao=atrasado` ja escreveu um `lt`, a faixa explicita do usuario
    // manda — mas o `status=pendente` permanece, que e o que "atrasado"
    // significa de fato.
    where.vencimento = { ...(where.vencimento as object), ...faixa };
  }

  /*
   * "Pontuais" da origem = lancamento avulso. Como `origem` e derivada, o
   * filtro vira condicao sobre os VINCULOS — e por isso nao ha como ela
   * divergir do que a lista mostra.
   */
  if (f.origem === "avulso") {
    where.recorrenciaId = null;
    where.parcelamentoId = null;
  } else if (f.origem === "parcelado") {
    where.parcelamentoId = { not: null };
  } else if (f.origem === "recorrente") {
    where.recorrencia = { is: { tipoProvisao: null } };
  } else if (f.origem === "provisao") {
    where.recorrencia = { is: { tipoProvisao: { not: null } } };
  }

  if (f.servico !== undefined) where.ehServico = f.servico;

  if (f.busca?.trim()) {
    const termo = f.busca.trim();
    const comoNumero = Number(termo);
    where.OR = [
      { descricao: { contains: termo, mode: "insensitive" } },
      { observacao: { contains: termo, mode: "insensitive" } },
      // Conciliar com o papel comeca por procurar o numero da nota.
      { numeroDocumento: { contains: termo, mode: "insensitive" } },
      // Buscar por "231" tem que achar o lancamento 231 — e como as pessoas
      // se referem a ele.
      ...(Number.isInteger(comoNumero) && comoNumero > 0 ? [{ numero: comoNumero }] : []),
    ];
  }

  return where;
}

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

export interface CriarArgs {
  tipo: "receita" | "despesa";
  descricao: string;
  valor: string;
  vencimento: string;
  competencia?: string;
  provedorId?: string | null;
  categoriaId?: string | null;
  observacao?: string | null;
  numeroDocumento?: string | null;
  ehServico?: boolean;
  autorId: string;
}

export async function criar(args: CriarArgs): Promise<LancamentoPublic> {
  const valor = exigirValor(args.valor);
  const vencimento = args.vencimento.slice(0, 10);
  dataCivil(vencimento, "vencimento");
  const competencia = args.competencia?.slice(0, 10) ?? competenciaDe(vencimento);
  dataCivil(competencia, "competencia");

  const criado = await prisma.$transaction(async (tx) => {
    const lancamento = await tx.lancamento.create({
      data: {
        tipo: args.tipo,
        descricao: args.descricao.trim(),
        valor: new Prisma.Decimal(valor),
        vencimento: dataCivil(vencimento),
        competencia: dataCivil(competencia),
        provedorId: args.provedorId ?? null,
        categoriaId: args.categoriaId ?? null,
        observacao: args.observacao?.trim() || null,
        numeroDocumento: args.numeroDocumento?.trim() || null,
        ehServico: args.ehServico ?? false,
        criadoPorId: args.autorId,
      },
      select: LANCAMENTO_SELECT,
    });
    await tx.lancamentoEvento.create({
      data: {
        lancamentoId: lancamento.id,
        tipo: "criado",
        autorId: args.autorId,
        detalhe: { valor, vencimento, tipo: args.tipo },
      },
    });
    return lancamento;
  });

  return toPublic(criado);
}

export interface BaixarArgs {
  id: string;
  pagoEm?: string;
  valorPago?: string;
  formaPagamento: "pix" | "boleto" | "transferencia" | "dinheiro" | "cartao" | "outro";
  observacao?: string | null;
  autorId: string;
}

/**
 * Dar baixa. CONCORRENTE-SEGURA: o update filtra por `status: "pendente"` e
 * confere quantas linhas mudaram. Dois admins clicando junto — o que costuma
 * acontecer quando chega o comprovante no grupo — nao geram duas baixas; o
 * segundo recebe 409 em vez de sobrescrever a data e a forma de pagamento do
 * primeiro em silencio.
 *
 * Baixa e evento na MESMA transacao. O ERP de origem documenta seis fluxos
 * financeiros nao-atomicos como divida critica; um lancamento pago sem registro
 * de quem pagou e exatamente o estado parcial que isso produz.
 */
export async function baixar(args: BaixarArgs): Promise<LancamentoPublic> {
  const atual = await prisma.lancamento.findUnique({
    where: { id: args.id },
    select: { id: true, status: true, valor: true },
  });
  if (!atual) throw new HttpError(404, "Lancamento nao encontrado");
  exigirTransicao(atual.status, "pago", "dar baixa");

  const pagoEm = args.pagoEm?.slice(0, 10) ?? hojeIso();
  dataCivil(pagoEm, "pagoEm");
  const valorPago = args.valorPago ? exigirValor(args.valorPago, "valorPago") : atual.valor.toFixed(2);

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.lancamento.updateMany({
      // A clausula de status E a trava de concorrencia — nao e redundante com
      // o findUnique acima, que so serve pra dar a mensagem de erro certa.
      where: { id: args.id, status: "pendente" },
      data: {
        status: "pago",
        pagoEm: dataCivil(pagoEm),
        valorPago: new Prisma.Decimal(valorPago),
        formaPagamento: args.formaPagamento,
        ...(args.observacao !== undefined ? { observacao: args.observacao?.trim() || null } : {}),
      },
    });
    if (count === 0) {
      throw new HttpError(409, "Este lancamento acabou de ser alterado por outra pessoa. Recarregue a tela.");
    }

    await tx.lancamentoEvento.create({
      data: {
        lancamentoId: args.id,
        tipo: "baixado",
        autorId: args.autorId,
        detalhe: { valorPago, pagoEm, formaPagamento: args.formaPagamento },
      },
    });

    const atualizado = await tx.lancamento.findUniqueOrThrow({
      where: { id: args.id },
      select: LANCAMENTO_SELECT,
    });
    return toPublic(atualizado);
  });
}

/** Estorno: desfaz a baixa e limpa os campos dela. Mesma trava de concorrencia. */
export async function estornar(id: string, autorId: string): Promise<LancamentoPublic> {
  const atual = await prisma.lancamento.findUnique({ where: { id }, select: { status: true } });
  if (!atual) throw new HttpError(404, "Lancamento nao encontrado");
  exigirTransicao(atual.status, "pendente", "estornar");

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.lancamento.updateMany({
      where: { id, status: "pago" },
      data: { status: "pendente", pagoEm: null, valorPago: null, formaPagamento: null },
    });
    if (count === 0) {
      throw new HttpError(409, "Este lancamento acabou de ser alterado por outra pessoa. Recarregue a tela.");
    }
    await tx.lancamentoEvento.create({ data: { lancamentoId: id, tipo: "estornado", autorId } });
    const atualizado = await tx.lancamento.findUniqueOrThrow({ where: { id }, select: LANCAMENTO_SELECT });
    return toPublic(atualizado);
  });
}

/**
 * Cancelar. Substitui o DELETE, que nao existe nesta API: registro de dinheiro
 * nao some — some do fluxo, mas fica no banco com quem cancelou e quando.
 */
export async function cancelar(id: string, autorId: string, motivo?: string): Promise<LancamentoPublic> {
  const atual = await prisma.lancamento.findUnique({ where: { id }, select: { status: true } });
  if (!atual) throw new HttpError(404, "Lancamento nao encontrado");
  exigirTransicao(atual.status, "cancelado", "cancelar");

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.lancamento.updateMany({
      where: { id, status: "pendente" },
      data: { status: "cancelado" },
    });
    if (count === 0) {
      throw new HttpError(409, "Este lancamento acabou de ser alterado por outra pessoa. Recarregue a tela.");
    }
    await tx.lancamentoEvento.create({
      data: { lancamentoId: id, tipo: "cancelado", autorId, detalhe: motivo ? { motivo } : undefined },
    });
    const atualizado = await tx.lancamento.findUniqueOrThrow({ where: { id }, select: LANCAMENTO_SELECT });
    return toPublic(atualizado);
  });
}

export interface EditarArgs {
  id: string;
  descricao?: string;
  valor?: string;
  vencimento?: string;
  competencia?: string;
  provedorId?: string | null;
  categoriaId?: string | null;
  observacao?: string | null;
  numeroDocumento?: string | null;
  ehServico?: boolean;
  autorId: string;
}

/** Editar so o que ainda esta pendente — mexer no valor de algo ja pago e reescrever a historia. */
export async function editar(args: EditarArgs): Promise<LancamentoPublic> {
  const atual = await prisma.lancamento.findUnique({ where: { id: args.id }, select: { status: true } });
  if (!atual) throw new HttpError(404, "Lancamento nao encontrado");
  if (atual.status !== "pendente") {
    throw new HttpError(409, `Nao da pra editar: o lancamento esta ${atual.status}. Estorne antes.`);
  }

  const data: Prisma.LancamentoUpdateInput = {};
  /*
   * Valores JSON-seguros, explicitamente (nao `Record<string, unknown>`): o
   * campo `detalhe` e Json, e um tipo frouxo deixaria passar um `Decimal` ou um
   * `Date` — justamente os dois que nao podem entrar aqui. Dinheiro entra como
   * STRING, como em todo o resto do modulo.
   */
  const detalhe: Record<string, string | number | boolean | null> = {};

  if (args.descricao !== undefined) {
    data.descricao = args.descricao.trim();
    detalhe.descricao = data.descricao;
  }
  if (args.valor !== undefined) {
    const valor = exigirValor(args.valor);
    data.valor = new Prisma.Decimal(valor);
    detalhe.valor = valor;
  }
  if (args.vencimento !== undefined) {
    const v = args.vencimento.slice(0, 10);
    data.vencimento = dataCivil(v, "vencimento");
    detalhe.vencimento = v;
  }
  if (args.competencia !== undefined) {
    const c = args.competencia.slice(0, 10);
    data.competencia = dataCivil(c, "competencia");
    detalhe.competencia = c;
  }
  if (args.provedorId !== undefined) {
    data.provedor = args.provedorId ? { connect: { id: args.provedorId } } : { disconnect: true };
    detalhe.provedorId = args.provedorId;
  }
  if (args.categoriaId !== undefined) {
    data.categoria = args.categoriaId ? { connect: { id: args.categoriaId } } : { disconnect: true };
    detalhe.categoriaId = args.categoriaId;
  }
  if (args.observacao !== undefined) {
    data.observacao = args.observacao?.trim() || null;
    detalhe.observacao = data.observacao;
  }
  if (args.numeroDocumento !== undefined) {
    data.numeroDocumento = args.numeroDocumento?.trim() || null;
    detalhe.numeroDocumento = data.numeroDocumento;
  }
  if (args.ehServico !== undefined) {
    data.ehServico = args.ehServico;
    detalhe.ehServico = args.ehServico;
  }

  return prisma.$transaction(async (tx) => {
    const atualizado = await tx.lancamento.update({
      where: { id: args.id },
      data,
      select: LANCAMENTO_SELECT,
    });
    await tx.lancamentoEvento.create({
      data: { lancamentoId: args.id, tipo: "editado", autorId: args.autorId, detalhe },
    });
    return toPublic(atualizado);
  });
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export const LIMITE_PAGINA = 200;

export async function listar(filtro: FiltroInterno, limite = LIMITE_PAGINA, offset = 0) {
  const hoje = hojeIso();
  const where = montarWhere(filtro, hoje);

  const [itens, total] = await Promise.all([
    prisma.lancamento.findMany({
      where,
      select: LANCAMENTO_SELECT,
      // Vencimento crescente: o que vence primeiro e o que precisa de decisao
      // primeiro. `numero` desempata pra ordenacao ser estavel entre paginas.
      orderBy: [{ vencimento: "asc" }, { numero: "asc" }],
      take: Math.min(limite, LIMITE_PAGINA),
      skip: offset,
    }),
    prisma.lancamento.count({ where }),
  ]);

  return { itens: itens.map((i) => toPublic(i, hoje)), total };
}

/**
 * Totais AGREGADOS NO BANCO. O `SUM` do Postgres sobre `numeric` e exato e nao
 * depende do que coube na pagina — somar os itens no navegador daria o total
 * da PAGINA passando por total geral, alem de reintroduzir float.
 */
export async function resumo(filtro: FiltroInterno): Promise<FinanceiroResumo> {
  const hoje = hojeIso();
  const hojeData = dataCivil(hoje);
  // O resumo responde sobre o RECORTE (provedor, categoria, periodo), mas nunca
  // sobre o recorte de situacao/tipo — senao "a receber" sumiria ao filtrar por
  // despesas, que e justamente quando se quer comparar os dois lados.
  const base = montarWhere({ ...filtro, tipo: undefined, situacao: undefined }, hoje);

  const soma = async (where: Prisma.LancamentoWhereInput) => {
    const r = await prisma.lancamento.aggregate({ where: { ...base, ...where }, _sum: { valor: true } });
    return (r._sum.valor ?? new Prisma.Decimal(0)).toFixed(2);
  };
  const somaPago = async (where: Prisma.LancamentoWhereInput) => {
    const r = await prisma.lancamento.aggregate({ where: { ...base, ...where }, _sum: { valorPago: true } });
    return (r._sum.valorPago ?? new Prisma.Decimal(0)).toFixed(2);
  };

  const [
    aReceberEmAberto,
    aPagarEmAberto,
    vencidoAReceber,
    vencidoAPagar,
    recebidoNoPeriodo,
    pagoNoPeriodo,
    quantidadeVencidos,
  ] = await Promise.all([
    soma({ tipo: "receita", status: "pendente" }),
    soma({ tipo: "despesa", status: "pendente" }),
    soma({ tipo: "receita", status: "pendente", vencimento: { lt: hojeData } }),
    soma({ tipo: "despesa", status: "pendente", vencimento: { lt: hojeData } }),
    somaPago({ tipo: "receita", status: "pago" }),
    somaPago({ tipo: "despesa", status: "pago" }),
    prisma.lancamento.count({ where: { ...base, status: "pendente", vencimento: { lt: hojeData } } }),
  ]);

  return {
    aReceberEmAberto,
    aPagarEmAberto,
    vencidoAReceber,
    vencidoAPagar,
    recebidoNoPeriodo,
    pagoNoPeriodo,
    quantidadeVencidos,
  };
}

export async function obter(id: string): Promise<LancamentoPublic> {
  const row = await prisma.lancamento.findUnique({ where: { id }, select: LANCAMENTO_SELECT });
  if (!row) throw new HttpError(404, "Lancamento nao encontrado");
  return toPublic(row);
}

export async function historico(id: string): Promise<LancamentoEventoPublic[]> {
  const eventos = await prisma.lancamentoEvento.findMany({
    where: { lancamentoId: id },
    orderBy: { criadoEm: "asc" },
    select: {
      id: true,
      tipo: true,
      detalhe: true,
      criadoEm: true,
      autor: { select: { nome: true } },
    },
  });
  return eventos.map(eventoToPublic);
}
