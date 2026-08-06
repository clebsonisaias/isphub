import { Prisma } from "@prisma/client";
import {
  competenciaDe,
  descricaoParcela,
  dividirEmParcelas,
  ocorrenciasEntre,
  type LancamentoTipo,
} from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import {
  LANCAMENTO_SELECT,
  dataCivil,
  exigirValor,
  isoDeData,
  moeda,
  toPublic as lancamentoToPublic,
} from "./lancamentoService.js";

/**
 * PARCELAMENTO — uma compra dividida em N vezes.
 *
 * Diferente da recorrencia: o total e o numero de parcelas ja sao conhecidos,
 * entao nao ha janela movel nem job. Todas as parcelas nascem de uma vez, e
 * cada uma e um `Lancamento` normal — com baixa, comprovante e historico
 * proprios.
 *
 * O ERP de origem encadeia CINCO escritas sem transacao pra criar uma compra
 * parcelada (parceladas -> installments -> sync -> company_purchases ->
 * estoque), e a documentacao dele lista isso como divida critica: "falha =
 * parcela criada sem estoque". Aqui o parcelamento e as parcelas nascem na
 * MESMA transacao — ou existe tudo, ou nao existe nada.
 */

export const PARCELAMENTO_SELECT = {
  id: true,
  tipo: true,
  descricao: true,
  valorTotal: true,
  quantidade: true,
  primeiroVencimento: true,
  provedorId: true,
  categoriaId: true,
  observacao: true,
  criadoEm: true,
  provedor: { select: { nome: true } },
  categoria: { select: { nome: true } },
  lancamentos: { select: { status: true } },
} satisfies Prisma.ParcelamentoSelect;

type Row = Prisma.ParcelamentoGetPayload<{ select: typeof PARCELAMENTO_SELECT }>;

export function toPublic(row: Row) {
  return {
    id: row.id,
    tipo: row.tipo,
    descricao: row.descricao,
    valorTotal: moeda(row.valorTotal)!,
    quantidade: row.quantidade,
    primeiroVencimento: isoDeData(row.primeiroVencimento)!,
    provedorId: row.provedorId,
    provedorNome: row.provedor?.nome ?? null,
    categoriaId: row.categoriaId,
    categoriaNome: row.categoria?.nome ?? null,
    observacao: row.observacao,
    parcelasPagas: row.lancamentos.filter((l) => l.status === "pago").length,
    criadoEm: row.criadoEm.toISOString(),
  };
}

export interface CriarArgs {
  tipo: LancamentoTipo;
  descricao: string;
  valorTotal: string;
  quantidade: number;
  primeiroVencimento: string;
  provedorId?: string | null;
  categoriaId?: string | null;
  observacao?: string | null;
  autorId: string;
}

export const MAX_PARCELAS = 120;

export async function criar(args: CriarArgs) {
  const valorTotal = exigirValor(args.valorTotal, "valorTotal");
  if (!Number.isInteger(args.quantidade) || args.quantidade < 2 || args.quantidade > MAX_PARCELAS) {
    throw new HttpError(400, `Numero de parcelas deve ser um inteiro entre 2 e ${MAX_PARCELAS}`);
  }
  dataCivil(args.primeiroVencimento, "primeiroVencimento");

  const valores = dividirEmParcelas(valorTotal, args.quantidade);

  /*
   * As datas usam o MESMO calculo da recorrencia (passo mensal com o dia preso
   * ao ultimo dia do mes). Sem isso, uma compra parcelada com primeira parcela
   * no dia 31 deslizaria a serie inteira ao passar por fevereiro — o bug que a
   * origem documenta.
   */
  const dia = Number(args.primeiroVencimento.slice(8, 10));
  const datas = ocorrenciasEntre({
    inicio: args.primeiroVencimento,
    fim: null,
    frequencia: "mensal",
    diaVencimento: dia,
    // Horizonte generoso: quem manda parar e a quantidade de parcelas.
    ate: `${Number(args.primeiroVencimento.slice(0, 4)) + 15}-12-31`,
  }).slice(0, args.quantidade);

  if (datas.length < args.quantidade) {
    throw new HttpError(400, "Nao foi possivel calcular todas as datas de vencimento");
  }

  // TUDO na mesma transacao: um parcelamento sem parcelas seria um registro
  // que promete N contas e nao entrega nenhuma.
  const criado = await prisma.$transaction(async (tx) => {
    const p = await tx.parcelamento.create({
      data: {
        tipo: args.tipo,
        descricao: args.descricao.trim(),
        valorTotal: new Prisma.Decimal(valorTotal),
        quantidade: args.quantidade,
        primeiroVencimento: dataCivil(args.primeiroVencimento),
        provedorId: args.provedorId ?? null,
        categoriaId: args.categoriaId ?? null,
        observacao: args.observacao?.trim() || null,
        criadoPorId: args.autorId,
      },
      select: { id: true },
    });

    await tx.lancamento.createMany({
      data: datas.map((vencimento, i) => ({
        tipo: args.tipo,
        descricao: descricaoParcela(args.descricao.trim(), i + 1, args.quantidade),
        valor: new Prisma.Decimal(valores[i]),
        vencimento: dataCivil(vencimento),
        competencia: dataCivil(competenciaDe(vencimento)),
        provedorId: args.provedorId ?? null,
        categoriaId: args.categoriaId ?? null,
        observacao: args.observacao?.trim() || null,
        criadoPorId: args.autorId,
        parcelamentoId: p.id,
        numeroParcela: i + 1,
      })),
    });

    return p.id;
  });

  return obter(criado);
}

export async function listar(tipo?: LancamentoTipo) {
  const rows = await prisma.parcelamento.findMany({
    where: tipo ? { tipo } : undefined,
    select: PARCELAMENTO_SELECT,
    orderBy: { criadoEm: "desc" },
  });
  return rows.map(toPublic);
}

export async function obter(id: string) {
  const row = await prisma.parcelamento.findUnique({ where: { id }, select: PARCELAMENTO_SELECT });
  if (!row) throw new HttpError(404, "Parcelamento nao encontrado");
  return toPublic(row);
}

/** As parcelas de um parcelamento, em ordem. */
export async function parcelas(id: string) {
  const rows = await prisma.lancamento.findMany({
    where: { parcelamentoId: id },
    select: LANCAMENTO_SELECT,
    orderBy: { numeroParcela: "asc" },
  });
  return rows.map((r) => lancamentoToPublic(r));
}
