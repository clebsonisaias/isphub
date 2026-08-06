import { Prisma } from "@prisma/client";
import {
  competenciaDe,
  hojeIso,
  mesAtual,
  ocorrenciasEntre,
  somarMeses,
  ultimoDiaDoMes,
  type FrequenciaRecorrencia,
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
 * RECORRENCIA — a regra que gera lancamentos repetidos.
 *
 * As ocorrencias sao MATERIALIZADAS como `Lancamento` normais, e por isso
 * herdam de graca tudo que ja existe: baixa com valor e forma proprios,
 * comprovante, historico, DRE, inadimplencia. O ERP de origem expande na
 * leitura e paga por uma tabela de override, e a documentacao dele registra o
 * preco disso — "valor pago diferente, metodo, chave fiscal e a nota nao sao
 * persistidos por ocorrencia".
 *
 * O risco de materializar e duplicar. La, o botao de sincronizar inseria sem
 * verificar nada e cada clique criava um conjunto completo novo. Aqui a trava e
 * `@@unique([recorrenciaId, vencimento])` no banco, e a geracao consulta o que
 * ja existe antes de inserir — os dois, porque o primeiro protege contra
 * corrida e o segundo permite dizer quantas foram criadas.
 */

/**
 * Quantos meses a frente materializar.
 *
 * Tres, nao doze: o lancamento existe pra ser pago, e uma lista com o ano
 * inteiro adiantado polui a fila de contas a pagar com coisa que nao vence tao
 * cedo. O job roda todo dia e vai empurrando a janela — quem tem recorrencia
 * indefinida nunca fica sem as proximas.
 */
export const HORIZONTE_MESES = 3;

/** O horizonte de geracao: ultimo dia do mes que fecha a janela. */
export function horizonteAtual(hoje: string = hojeIso()): string {
  return ultimoDiaDoMes(somarMeses(mesAtual(new Date(`${hoje}T12:00:00.000Z`)), HORIZONTE_MESES));
}

export const RECORRENCIA_SELECT = {
  id: true,
  tipo: true,
  descricao: true,
  valor: true,
  frequencia: true,
  diaVencimento: true,
  inicio: true,
  fim: true,
  ativa: true,
  provedorId: true,
  categoriaId: true,
  observacao: true,
  criadoEm: true,
  provedor: { select: { nome: true, cor: true } },
  categoria: { select: { nome: true, cor: true } },
  _count: { select: { lancamentos: true } },
} satisfies Prisma.RecorrenciaSelect;

type RecorrenciaRow = Prisma.RecorrenciaGetPayload<{ select: typeof RECORRENCIA_SELECT }>;

export function toPublic(row: RecorrenciaRow) {
  return {
    id: row.id,
    tipo: row.tipo,
    descricao: row.descricao,
    valor: moeda(row.valor)!,
    frequencia: row.frequencia,
    diaVencimento: row.diaVencimento,
    inicio: isoDeData(row.inicio)!,
    fim: isoDeData(row.fim),
    ativa: row.ativa,
    provedorId: row.provedorId,
    provedorNome: row.provedor?.nome ?? null,
    provedorCor: row.provedor?.cor ?? null,
    categoriaId: row.categoriaId,
    categoriaNome: row.categoria?.nome ?? null,
    observacao: row.observacao,
    /** Quantas ocorrencias ja foram materializadas. */
    ocorrenciasGeradas: row._count.lancamentos,
    criadoEm: row.criadoEm.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Geracao
// ---------------------------------------------------------------------------

export interface ResultadoGeracao {
  criados: number;
  existentes: number;
}

/**
 * Materializa as ocorrencias que faltam ate o horizonte. IDEMPOTENTE.
 *
 * Chamar duas vezes seguidas deixa o mesmo conjunto — e o `existentes` do
 * retorno diz quantas ja estavam la, pra mensagem na tela nao mentir dizendo
 * "geradas" quando nao gerou nada.
 */
export async function gerarOcorrencias(recorrenciaId: string, hoje: string = hojeIso()): Promise<ResultadoGeracao> {
  const r = await prisma.recorrencia.findUnique({
    where: { id: recorrenciaId },
    select: {
      id: true,
      tipo: true,
      descricao: true,
      valor: true,
      frequencia: true,
      diaVencimento: true,
      inicio: true,
      fim: true,
      ativa: true,
      provedorId: true,
      categoriaId: true,
      observacao: true,
      criadoPorId: true,
    },
  });
  if (!r) throw new HttpError(404, "Recorrencia nao encontrada");
  // Recorrencia desligada nao gera. As ocorrencias ja materializadas ficam —
  // sao contas reais, algumas ja pagas; apaga-las reescreveria o passado.
  if (!r.ativa) return { criados: 0, existentes: 0 };

  const datas = ocorrenciasEntre({
    inicio: isoDeData(r.inicio)!,
    fim: isoDeData(r.fim),
    frequencia: r.frequencia,
    diaVencimento: r.diaVencimento,
    ate: horizonteAtual(hoje),
  });
  if (datas.length === 0) return { criados: 0, existentes: 0 };

  const jaExistem = await prisma.lancamento.findMany({
    where: { recorrenciaId: r.id, vencimento: { in: datas.map((d) => dataCivil(d)) } },
    select: { vencimento: true },
  });
  const existentes = new Set(jaExistem.map((l) => isoDeData(l.vencimento)!));
  const faltando = datas.filter((d) => !existentes.has(d));
  if (faltando.length === 0) return { criados: 0, existentes: datas.length };

  /*
   * `skipDuplicates` E a consulta acima. Redundante de proposito: a consulta
   * permite CONTAR o que foi criado (a mensagem na tela depende disso), e o
   * skip protege da corrida entre a consulta e o insert — dois containers
   * gerando ao mesmo tempo num deploy sobreposto.
   */
  const { count } = await prisma.lancamento.createMany({
    data: faltando.map((vencimento) => ({
      tipo: r.tipo,
      descricao: r.descricao,
      valor: r.valor,
      vencimento: dataCivil(vencimento),
      competencia: dataCivil(competenciaDe(vencimento)),
      provedorId: r.provedorId,
      categoriaId: r.categoriaId,
      observacao: r.observacao,
      criadoPorId: r.criadoPorId,
      recorrenciaId: r.id,
    })),
    skipDuplicates: true,
  });

  return { criados: count, existentes: datas.length - count };
}

/** Gera para TODAS as recorrencias ativas — o que o job chama. */
export async function gerarTodas(hoje: string = hojeIso()): Promise<ResultadoGeracao & { recorrencias: number }> {
  const ativas = await prisma.recorrencia.findMany({ where: { ativa: true }, select: { id: true } });
  let criados = 0;
  let existentes = 0;
  for (const { id } of ativas) {
    // Uma recorrencia com dado ruim nao pode impedir as outras de gerar.
    try {
      const r = await gerarOcorrencias(id, hoje);
      criados += r.criados;
      existentes += r.existentes;
    } catch (err) {
      console.error(`[recorrencia] falha ao gerar ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { criados, existentes, recorrencias: ativas.length };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface RecorrenciaArgs {
  tipo: LancamentoTipo;
  descricao: string;
  valor: string;
  frequencia: FrequenciaRecorrencia;
  diaVencimento: number;
  inicio: string;
  fim?: string | null;
  provedorId?: string | null;
  categoriaId?: string | null;
  observacao?: string | null;
  autorId: string;
}

export async function criar(args: RecorrenciaArgs) {
  const valor = exigirValor(args.valor);
  dataCivil(args.inicio, "inicio");
  if (args.fim) {
    dataCivil(args.fim, "fim");
    if (args.fim < args.inicio) throw new HttpError(400, "O fim nao pode ser antes do inicio");
  }

  const criada = await prisma.recorrencia.create({
    data: {
      tipo: args.tipo,
      descricao: args.descricao.trim(),
      valor: new Prisma.Decimal(valor),
      frequencia: args.frequencia,
      diaVencimento: args.diaVencimento,
      inicio: dataCivil(args.inicio),
      fim: args.fim ? dataCivil(args.fim) : null,
      provedorId: args.provedorId ?? null,
      categoriaId: args.categoriaId ?? null,
      observacao: args.observacao?.trim() || null,
      criadoPorId: args.autorId,
    },
    select: { id: true },
  });

  // Gera na hora: uma recorrencia criada hoje que so aparecesse amanha, quando
  // o job roda, pareceria que nao funcionou.
  const geracao = await gerarOcorrencias(criada.id);
  return { recorrencia: await obter(criada.id), geracao };
}

export interface EditarArgs extends Partial<Omit<RecorrenciaArgs, "autorId" | "tipo">> {
  id: string;
  ativa?: boolean;
}

/**
 * Editar a REGRA nao reescreve o que ja foi gerado.
 *
 * As ocorrencias materializadas sao contas reais — algumas ja pagas, com
 * comprovante anexado. Mudar o valor da regra vale das PROXIMAS em diante; para
 * corrigir uma ocorrencia especifica, edita-se ela na lista.
 */
export async function editar(args: EditarArgs) {
  const atual = await prisma.recorrencia.findUnique({ where: { id: args.id }, select: { inicio: true } });
  if (!atual) throw new HttpError(404, "Recorrencia nao encontrada");

  const data: Prisma.RecorrenciaUpdateInput = {};
  if (args.descricao !== undefined) data.descricao = args.descricao.trim();
  if (args.valor !== undefined) data.valor = new Prisma.Decimal(exigirValor(args.valor));
  if (args.frequencia !== undefined) data.frequencia = args.frequencia;
  if (args.diaVencimento !== undefined) data.diaVencimento = args.diaVencimento;
  if (args.inicio !== undefined) data.inicio = dataCivil(args.inicio, "inicio");
  if (args.fim !== undefined) data.fim = args.fim ? dataCivil(args.fim, "fim") : null;
  if (args.ativa !== undefined) data.ativa = args.ativa;
  if (args.observacao !== undefined) data.observacao = args.observacao?.trim() || null;
  if (args.provedorId !== undefined) {
    data.provedor = args.provedorId ? { connect: { id: args.provedorId } } : { disconnect: true };
  }
  if (args.categoriaId !== undefined) {
    data.categoria = args.categoriaId ? { connect: { id: args.categoriaId } } : { disconnect: true };
  }

  await prisma.recorrencia.update({ where: { id: args.id }, data });
  const geracao = await gerarOcorrencias(args.id);
  return { recorrencia: await obter(args.id), geracao };
}

export async function listar(tipo?: LancamentoTipo) {
  const rows = await prisma.recorrencia.findMany({
    where: tipo ? { tipo } : undefined,
    select: RECORRENCIA_SELECT,
    // Ativas primeiro: a lista existe pra acompanhar o que esta rodando.
    orderBy: [{ ativa: "desc" }, { descricao: "asc" }],
  });
  return rows.map(toPublic);
}

export async function obter(id: string) {
  const row = await prisma.recorrencia.findUnique({ where: { id }, select: RECORRENCIA_SELECT });
  if (!row) throw new HttpError(404, "Recorrencia nao encontrada");
  return toPublic(row);
}

/**
 * As ocorrencias JA materializadas de uma recorrencia — o que a tela mostra ao
 * expandir uma linha.
 */
export async function ocorrencias(id: string) {
  const rows = await prisma.lancamento.findMany({
    where: { recorrenciaId: id },
    select: LANCAMENTO_SELECT,
    orderBy: { vencimento: "asc" },
  });
  return rows.map((r) => lancamentoToPublic(r));
}
