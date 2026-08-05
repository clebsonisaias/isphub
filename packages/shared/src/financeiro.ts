/**
 * FINANCEIRO DA HUBISP — contas a pagar e a receber da propria empresa.
 *
 * "A receber" = o que cada provedor paga a hub (contrato provedor<->HubISP).
 * "A pagar"   = despesa da propria hub.
 *
 * NAO tem nada a ver com titulo/fatura/boleto do assinante final do SGP: esse
 * dinheiro e do provedor, nao da hub, e o conector SGP nao e consultado aqui.
 *
 * ---------------------------------------------------------------------------
 * A REGRA DO DINHEIRO
 *
 * Todo campo monetario deste arquivo e `string`, nunca `number`. JSON nao tem
 * decimal: `1234.56` sai da API como double IEEE-754 e ja perdeu a garantia
 * antes de chegar na tela. A API serializa o `Decimal(14,2)` do Postgres como
 * string e o cliente **nunca soma dinheiro** — total vem do servidor, via
 * agregacao (o SUM do Postgres sobre numeric e exato).
 *
 * Use `formatarMoeda` pra exibir e `paraCentavos` quando precisar comparar.
 * ---------------------------------------------------------------------------
 */

export const LANCAMENTO_TIPOS = ["receita", "despesa"] as const;
export type LancamentoTipo = (typeof LANCAMENTO_TIPOS)[number];

/**
 * So o que e FATO. "Atrasado" NAO esta aqui de proposito: e funcao pura de
 * (vencimento < hoje && status = pendente) e por isso e derivado na leitura
 * (ver `estaAtrasado`). Grava-lo exigiria um job virando linhas, e entre duas
 * execucoes desse job o banco mentiria.
 */
export const LANCAMENTO_STATUS = ["pendente", "pago", "cancelado"] as const;
export type LancamentoStatus = (typeof LANCAMENTO_STATUS)[number];

export const FORMAS_PAGAMENTO = ["pix", "boleto", "transferencia", "dinheiro", "cartao", "outro"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const FORMA_PAGAMENTO_ROTULO: Record<FormaPagamento, string> = {
  pix: "Pix",
  boleto: "Boleto",
  transferencia: "Transferência",
  dinheiro: "Dinheiro",
  cartao: "Cartão",
  outro: "Outro",
};

export const LANCAMENTO_EVENTO_TIPOS = ["criado", "editado", "baixado", "estornado", "cancelado"] as const;
export type LancamentoEventoTipo = (typeof LANCAMENTO_EVENTO_TIPOS)[number];

/**
 * Estado EXIBIDO — o que existe no banco (`LancamentoStatus`) mais o atrasado
 * derivado. Separar os dois tipos e o que impede alguem tentar gravar
 * "atrasado" numa coluna que nao aceita.
 */
export type LancamentoSituacao = LancamentoStatus | "atrasado";

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CategoriaFinanceiraPublic {
  id: string;
  nome: string;
  tipo: LancamentoTipo;
  cor: string;
  ativo: boolean;
}

export interface LancamentoEventoPublic {
  id: string;
  tipo: LancamentoEventoTipo;
  autorNome: string | null;
  /** Valores monetarios aqui tambem sao string. */
  detalhe: Record<string, unknown> | null;
  criadoEm: string;
}

export interface LancamentoPublic {
  id: string;
  /** Identificador humano — e por ele que duas pessoas falam do mesmo lancamento. */
  numero: number;
  tipo: LancamentoTipo;
  status: LancamentoStatus;
  /** Status + atrasado derivado. E o que a UI pinta. */
  situacao: LancamentoSituacao;
  descricao: string;
  /** Dinheiro: string sempre. Ex.: "1234.56". */
  valor: string;
  /** Data civil "YYYY-MM-DD" — sem hora, sem fuso, sem deslocar um dia. */
  vencimento: string;
  /** Mes de referencia "YYYY-MM-DD" (sempre dia 1). */
  competencia: string;

  pagoEm: string | null;
  valorPago: string | null;
  formaPagamento: FormaPagamento | null;

  /** Contraparte (quem deve a hub). Null nas despesas da propria hub. */
  provedorId: string | null;
  provedorNome: string | null;
  provedorCor: string | null;

  categoriaId: string | null;
  categoriaNome: string | null;
  categoriaCor: string | null;

  observacao: string | null;

  temComprovante: boolean;
  comprovanteNome: string | null;

  criadoPorNome: string | null;
  criadoEm: string;
}

export interface LancamentoInput {
  tipo: LancamentoTipo;
  descricao: string;
  /** String, sempre. Aceita "1234.56" ou "1234,56". */
  valor: string;
  vencimento: string;
  /** Omitido = deduzido do vencimento (primeiro dia do mes dele). */
  competencia?: string;
  provedorId?: string | null;
  categoriaId?: string | null;
  observacao?: string | null;
}

export interface BaixaInput {
  /** Omitido = hoje. */
  pagoEm?: string;
  /** Omitido = o proprio `valor` do lancamento (pagamento cheio). */
  valorPago?: string;
  formaPagamento: FormaPagamento;
  observacao?: string | null;
}

/** Filtros da listagem. Tudo opcional; nada aqui e fronteira de acesso. */
export interface LancamentoFiltro {
  tipo?: LancamentoTipo;
  situacao?: LancamentoSituacao;
  provedorId?: string;
  categoriaId?: string;
  /** Recorte por vencimento, "YYYY-MM-DD". */
  de?: string;
  ate?: string;
  busca?: string;
}

/**
 * Totais AGREGADOS PELO SERVIDOR. O cliente exibe, nunca recalcula — somar
 * uma pagina de lancamentos no navegador daria o total da PAGINA, nao o total,
 * alem de reintroduzir aritmetica de float.
 */
export interface FinanceiroResumo {
  aReceberEmAberto: string;
  aPagarEmAberto: string;
  vencidoAReceber: string;
  vencidoAPagar: string;
  recebidoNoPeriodo: string;
  pagoNoPeriodo: string;
  quantidadeVencidos: number;
}

export interface LancamentoListaResposta {
  itens: LancamentoPublic[];
  total: number;
  resumo: FinanceiroResumo;
}

// ---------------------------------------------------------------------------
// Helpers puros (compartilhados entre API e web pra nao divergirem)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" de hoje no fuso LOCAL de quem chama. */
export function hojeIso(agora: Date = new Date()): string {
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/**
 * Atrasado = pendente E vencido. Comparacao de STRING "YYYY-MM-DD", que ordena
 * lexicograficamente igual a cronologicamente — de proposito: converter pra
 * Date so pra comparar reabriria a porta do bug de fuso.
 *
 * Vencer HOJE nao e atraso: o dia ainda nao acabou.
 */
export function estaAtrasado(status: LancamentoStatus, vencimento: string, hoje: string = hojeIso()): boolean {
  return status === "pendente" && vencimento < hoje;
}

export function situacaoDe(status: LancamentoStatus, vencimento: string, hoje: string = hojeIso()): LancamentoSituacao {
  return estaAtrasado(status, vencimento, hoje) ? "atrasado" : status;
}

/** Primeiro dia do mes de uma data "YYYY-MM-DD" — a competencia padrao. */
export function competenciaDe(vencimento: string): string {
  return `${vencimento.slice(0, 7)}-01`;
}

/**
 * Normaliza dinheiro digitado para a forma canonica "1234.56".
 * Aceita "1.234,56" (pt-BR), "1234,56" e "1234.56". Devolve null se nao for
 * um valor monetario valido e positivo.
 */
export function normalizarValor(entrada: string): string | null {
  const bruto = entrada.trim();
  if (!bruto) return null;

  // pt-BR usa virgula como decimal: se ha virgula, o ponto e separador de
  // milhar e some. Sem virgula, o ponto E o decimal.
  const limpo = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(limpo)) return null;

  const [inteiro, decimal = ""] = limpo.split(".");
  const centavos = decimal.padEnd(2, "0");
  if (inteiro === "0" && centavos === "00") return null; // lancamento de R$ 0 nao e lancamento
  return `${inteiro}.${centavos}`;
}

/**
 * Converte "1234.56" em 123456 (centavos, inteiro). Use para COMPARAR ou
 * somar em JavaScript quando nao houver jeito de deixar a soma no banco —
 * inteiro nao acumula erro, `Number("0.1") + Number("0.2")` acumula.
 */
export function paraCentavos(valor: string): number {
  const [inteiro, decimal = "00"] = valor.split(".");
  return Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
}

export function deCentavos(centavos: number): string {
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "1234.56" -> "R$ 1.234,56". Formata a STRING, nao converte pra number. */
export function formatarMoeda(valor: string): string {
  const negativo = valor.startsWith("-");
  const [inteiro, decimal = "00"] = (negativo ? valor.slice(1) : valor).split(".");
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}R$ ${comMilhar},${decimal.padEnd(2, "0")}`;
}

/** "2026-08-05" -> "05/08/2026". Fatia a string; nunca constroi um Date. */
export function formatarDataIso(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/** "2026-08-01" -> "ago/2026". */
export function formatarCompetencia(iso: string): string {
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const [ano, mes] = iso.slice(0, 10).split("-");
  return `${MESES[Number(mes) - 1]}/${ano}`;
}
