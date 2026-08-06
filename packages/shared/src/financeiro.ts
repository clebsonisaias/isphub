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

/**
 * Onde a despesa entra no DRE. Vive na CATEGORIA, nao no lancamento — o ERP de
 * origem poe em cada transacao e a documentacao deles registra o desfecho:
 * "despesas sem classificacao caem silenciosamente em custos variaveis".
 * Ninguem preenche um campo a cada lancamento.
 */
export const CLASSIFICACOES_DRE = ["deducao", "custo_variavel", "despesa_operacional"] as const;
export type ClassificacaoDre = (typeof CLASSIFICACOES_DRE)[number];

export const CLASSIFICACAO_DRE_ROTULO: Record<ClassificacaoDre, string> = {
  deducao: "Dedução (imposto sobre a receita)",
  custo_variavel: "Custo variável",
  despesa_operacional: "Despesa operacional",
};

export interface CategoriaFinanceiraPublic {
  id: string;
  nome: string;
  tipo: LancamentoTipo;
  cor: string;
  ativo: boolean;
  /** Null = ainda nao classificada; o DRE mostra o valor em linha propria. */
  classificacao: ClassificacaoDre | null;
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
// RELATORIOS
// ---------------------------------------------------------------------------

/**
 * COMPETENCIA x CAIXA — a distincao que muda o numero, nao o rotulo.
 *
 * `competencia`: o mes a que o lancamento PERTENCE, pago ou nao. E o que um
 * DRE de verdade mede — quanto a empresa faturou e gastou naquele mes.
 *
 * `caixa`: o mes em que o dinheiro ENTROU ou SAIU (so o que ja foi baixado,
 * agrupado por `pagoEm`). E o que responde "sobrou dinheiro?".
 *
 * O ERP de origem agrega pela data de VENCIMENTO, que nao e nenhum dos dois:
 * uma mensalidade de marco vencendo 10/abril entra em abril no DRE deles.
 */
export const REGIMES = ["competencia", "caixa"] as const;
export type Regime = (typeof REGIMES)[number];

/** Uma linha do DRE. `ehTotal` marca subtotais (nao sao somaveis entre si). */
export interface DreLinha {
  chave: string;
  rotulo: string;
  /** Dinheiro, string. Despesa vem POSITIVA; o sinal esta no `operacao`. */
  valor: string;
  operacao: "soma" | "subtrai" | "total";
  /** Percentual sobre a receita bruta, ja calculado no servidor ("12.4"). */
  percentualDaReceita: string | null;
  /** Destaque visual: linha que exige atencao (ex.: sem classificacao). */
  alerta?: boolean;
}

export interface DreResultado {
  regime: Regime;
  /** Recorte "YYYY-MM" inclusivo. */
  de: string;
  ate: string;
  linhas: DreLinha[];
  /** Quanto ficou sem classificacao — se > 0, o DRE esta incompleto e diz isso. */
  semClassificacao: string;
  /** Quantos lancamentos de despesa estao sem categoria/classificacao. */
  quantidadeSemClassificacao: number;
}

/** Faixas de atraso. Os limites sao em DIAS e o ultimo e aberto. */
export const FAIXAS_ATRASO = [
  { chave: "ate30", rotulo: "1 a 30 dias", min: 1, max: 30 },
  { chave: "ate60", rotulo: "31 a 60 dias", min: 31, max: 60 },
  { chave: "ate90", rotulo: "61 a 90 dias", min: 61, max: 90 },
  { chave: "mais90", rotulo: "mais de 90 dias", min: 91, max: null },
] as const;

export type FaixaAtraso = (typeof FAIXAS_ATRASO)[number]["chave"];

export interface InadimplenciaProvedor {
  provedorId: string | null;
  provedorNome: string;
  provedorCor: string | null;
  /** Total vencido e em aberto. */
  total: string;
  quantidade: number;
  /** Dias de atraso do lancamento MAIS ANTIGO — e o que indica gravidade. */
  diasAtrasoMaximo: number;
  porFaixa: Record<FaixaAtraso, string>;
}

export interface InadimplenciaResultado {
  /** Soma de tudo que provedor deve a hub e ja venceu. */
  total: string;
  quantidade: number;
  porProvedor: InadimplenciaProvedor[];
  porFaixa: Record<FaixaAtraso, string>;
}

/** Um mes da serie. `mes` e "YYYY-MM". */
export interface SerieMensalPonto {
  mes: string;
  receita: string;
  despesa: string;
  /** receita - despesa, ja calculado no servidor (pode ser negativo). */
  resultado: string;
}

export interface SerieMensalResultado {
  regime: Regime;
  pontos: SerieMensalPonto[];
}

/** Composicao de despesa por categoria no periodo — alimenta as barras. */
export interface ComposicaoCategoria {
  categoriaId: string | null;
  nome: string;
  cor: string;
  classificacao: ClassificacaoDre | null;
  valor: string;
}

// ---------------------------------------------------------------------------
// Helpers puros (compartilhados entre API e web pra nao divergirem)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Meses (aritmetica de calendario sem Date)
// ---------------------------------------------------------------------------

/**
 * Toda a aritmetica de mes acontece sobre a string "YYYY-MM".
 *
 * Nao e preciosismo: `new Date(2026, 0, 31)` mais um mes da 03/03, porque o
 * Date corrige o dia 31 de fevereiro sozinho. Somar mes em campo de mes nao
 * deveria depender de dia nenhum — aqui nao depende.
 */

/** "YYYY-MM" do mes de hoje. */
export function mesAtual(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-08" + 1 -> "2026-09"; "2026-12" + 1 -> "2027-01"; aceita negativo. */
export function somarMeses(mes: string, delta: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const total = ano * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Lista inclusiva de "YYYY-MM" de `de` ate `ate`. Vazia se `de` > `ate`. */
export function mesesEntre(de: string, ate: string): string[] {
  const meses: string[] = [];
  let atual = de;
  // Teto de 120 meses: recorte maior que 10 anos e engano de digitacao, e um
  // laco sem teto sobre entrada de usuario e como se trava um servidor.
  for (let i = 0; atual <= ate && i < 120; i++) {
    meses.push(atual);
    atual = somarMeses(atual, 1);
  }
  return meses;
}

/** Primeiro dia do mes ("2026-08" -> "2026-08-01") — a forma da competencia. */
export function primeiroDiaDoMes(mes: string): string {
  return `${mes}-01`;
}

/** Ultimo dia do mes ("2026-02" -> "2026-02-29" em ano bissexto). */
export function ultimoDiaDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  // Dia 0 do mes SEGUINTE e o ultimo do atual — e o unico uso de Date aqui,
  // em UTC, e so pra descobrir quantos dias o mes tem.
  const dias = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return `${mes}-${String(dias).padStart(2, "0")}`;
}

/** "2026-08" -> "ago/26". Rotulo curto, pro eixo do grafico. */
export function formatarMesCurto(mes: string): string {
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1]}/${ano.slice(2)}`;
}

/** Dias entre duas datas civis (positivo se `ate` e depois de `de`). */
export function diasEntre(de: string, ate: string): number {
  const MS_DIA = 86_400_000;
  // Meio-dia UTC nos dois lados: a diferenca fica exata mesmo atravessando
  // horario de verao, que e onde uma conta ingenua erra por uma hora e
  // arredonda pro dia errado.
  const a = Date.parse(`${de}T12:00:00.000Z`);
  const b = Date.parse(`${ate}T12:00:00.000Z`);
  return Math.round((b - a) / MS_DIA);
}
