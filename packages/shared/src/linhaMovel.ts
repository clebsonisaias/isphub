/**
 * Linha movel corporativa (Brazmovel/CITmax) — SO LEITURA.
 *
 * O tecnico de campo usa um chip da empresa e nao tinha como saber quanto de
 * franquia sobrou nem se a linha esta ativa. Aqui ficam os tipos do contrato e
 * a aritmetica que pode estar errada em silencio — formatacao de numero,
 * conversao de bytes, rotulo de status. Nada disso toca banco nem rede, entao
 * tudo e testavel sem subir nada.
 *
 * ## O que NUNCA pode sair daqui para o app
 *
 * - **Preco.** O `product.price` da Brazmovel e ATACADO — o que a CITmax paga
 *   por linha (conferido na API: 3000 = R$ 30,00 num plano vendido a varejo por
 *   outro valor). No app do CLIENTE isso vazaria margem; aqui e pior, porque o
 *   chip e corporativo e o tecnico nao paga nada — qualquer valor na tela seria,
 *   por definicao, o custo da empresa. Nao existe versao "de varejo" para por no
 *   lugar. Por isso o historico mostra O QUE ele teve, nunca quanto custou.
 * - **ICCID/IMSI/PUK/EID/IMEI** — identificadores do chip.
 * - **Dados do parceiro** (`balance`, `comission`, `cnpj` do `GET /me`) e dados
 *   pessoais do titular (`cpf`, `email`, `birthdate`, `address`).
 */

/** Uma faixa de franquia (dados, bonus, redes sociais...). */
export interface CategoriaConsumo {
  descricao: string;
  restanteGb: number;
  totalGb: number;
}

/**
 * Consumo do CICLO ATUAL, ja em GB (a operadora entrega bytes).
 *
 * Nao ha serie historica: `GET /line/{id}/usage` devolve um retrato do momento e
 * nada mais — sem parametro de periodo, sem ciclo anterior. Por isso o rotulo na
 * tela e "ciclo atual" e nunca "este mes".
 */
export interface ConsumoLinha {
  restanteGb: number;
  totalGb: number;
  categorias: CategoriaConsumo[];
}

/**
 * O plano ATIVO da linha.
 *
 * So o corrente: planos anteriores nao sao mostrados. O que o tecnico precisa em
 * campo e o que vale agora e quanto sobrou — o que ele teve mes passado nao muda
 * decisao nenhuma, e ocupava a tela com uma lista que ninguem abre.
 */
export interface PlanoLinha {
  nome: string;
  descricao?: string;
  /** Status tecnico do plano na operadora (ACTIVE, CANCELED, ...). */
  status: string;
  statusRotulo: string;
  /** ISO. Quando o plano comecou a valer. */
  inicioEm: string | null;
  /** ISO. No plano ativo e a proxima renovacao; no historico, quando terminou. */
  fimEm: string | null;
  /** Renova sozinho ao fim do ciclo. */
  recorrente: boolean;
}

/**
 * A linha do tecnico, normalizada.
 *
 * `consumo` e `plano` sao opcionais de proposito, e a ausencia deles nao e a
 * mesma coisa que `consumoIndisponivel` — ver o comentario desse campo.
 */
export interface LinhaMovel {
  /** Numero formatado "(84) 98810-2532"; null enquanto a linha esta em ativacao. */
  numero: string | null;
  /**
   * Em ativacao (PRE_ACTIVE). Nesse estado a operadora devolve msisdn e ICCID
   * ALEATORIOS — mostrar seria mostrar o numero errado com cara de certo.
   */
  emAtivacao: boolean;
  /** Status tecnico da operadora (ACTIVE, BLOCKED, ...). */
  status: string;
  statusRotulo: string;
  plano?: PlanoLinha;
  consumo?: ConsumoLinha;
  /**
   * A consulta de consumo/plano FALHOU — diferente de "a linha nao tem plano".
   *
   * Sem esta distincao, um erro de rede vira "0 GB restantes" na tela, e o
   * tecnico conclui que a franquia acabou. Numa tela cujo proposito inteiro e
   * mostrar quanto sobrou, engolir o erro e o pior resultado possivel.
   */
  consumoIndisponivel?: boolean;
}

export interface BrazmovelCredentials {
  url: string;
  token: string;
}

/** Resultado de uma sondagem de credencial, com o status HTTP observado. */
export interface TesteConexao {
  ok: boolean;
  /** Status HTTP cru (0 = nao alcancou). Guardado para diagnostico futuro. */
  httpStatus: number | null;
  detalhe?: string;
}

/** Uma linha achada no vinculo — o MINIMO para o admin confirmar identidade. */
export interface LinhaCandidata {
  /** Opaco, e o que fica guardado no usuario. */
  lineId: string;
  /** "(84) *****-2532" — o suficiente para reconhecer, nao para anotar. */
  numeroMascarado: string | null;
  statusRotulo: string;
}

/** Conector Brazmovel — so leitura, sem uma unica escrita. */
export interface BrazmovelConnector {
  testarConexao(): Promise<TesteConexao>;
  /** Linhas de um CPF, so o necessario para o admin escolher e confirmar. */
  candidatasPorCpf(cpf: string): Promise<{ nomeTitular: string | null; linhas: LinhaCandidata[] }>;
  /** A linha inteira, por id — o caminho que o app do tecnico usa. */
  consultarLinha(lineId: string): Promise<LinhaMovel | null>;
}

// ---------------------------------------------------------------------------
// Aritmetica e formatacao (puras, testadas)
// ---------------------------------------------------------------------------

export const ROTULO_STATUS_LINHA: Record<string, string> = {
  ACTIVE: "Ativa",
  PRE_ACTIVE: "Em ativação",
  BLOCKED: "Bloqueada",
  INACTIVE: "Inativa",
  PORTOUT: "Portada para outra operadora",
};

export const ROTULO_STATUS_PLANO: Record<string, string> = {
  ACTIVE: "Ativo",
  CANCELED: "Cancelado",
  CANCELLED: "Cancelado",
  EXPIRED: "Encerrado",
  FINISHED: "Encerrado",
  BLOCKED: "Bloqueado",
  PENDING: "Pendente",
};

/**
 * O nome do plano com a marca COMERCIAL, nao a do fornecedor.
 *
 * A operadora devolve "Braz Móvel 20GB" em `product.title`, mas quem vende a
 * linha para o tecnico e a CITmax — "Brazmóvel" e o atacadista, e nome de
 * atacadista nao aparece para o usuario final. Aqui, no unico ponto por onde o
 * nome passa, vira "CITmóvel 20GB".
 *
 * Casa com as variacoes que a operadora ja usou ("Braz Móvel", "Braz Movel",
 * "Brazmóvel"), com ou sem espaco, acento ou caixa — porque o catalogo deles
 * muda sem aviso e um plano novo escrito diferente reintroduziria a marca errada
 * em silencio.
 */
export function marcaComercial(nome: string | null | undefined): string {
  return String(nome ?? "").replace(/braz\s*m[oó]vel/gi, "CITmóvel");
}

export function rotuloStatusLinha(status: string | null | undefined): string {
  return ROTULO_STATUS_LINHA[String(status ?? "")] ?? "Desconhecido";
}

export function rotuloStatusPlano(status: string | null | undefined): string {
  return ROTULO_STATUS_PLANO[String(status ?? "")] ?? "Desconhecido";
}

/**
 * Bytes → GB **decimal** (1 casa).
 *
 * Divisor 1e9 e nao 1024³: e assim que a operadora conta a franquia, e usar o
 * binario faria um plano de 20 GB aparecer como 18,6 GB — o tipo de erro que
 * ninguem reporta como bug, so desconfia do sistema.
 */
export function bytesParaGb(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / 1_000_000_000) * 10) / 10;
}

/** "5584988102532" → "(84) 98810-2532". Comprimento estranho vira `null`. */
export function formatarMsisdn(bruto: unknown): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
}

/**
 * "(84) 98810-2532" → "(84) *****-2532".
 *
 * Para a tela de VINCULO do admin: ele precisa reconhecer a linha do funcionario
 * que esta cadastrando, nao ficar com o numero de um terceiro anotado. O token
 * da Brazmovel vale para a base inteira, entao essa tela e o unico ponto do
 * sistema onde um CPF qualquer produz resposta — ela devolve o minimo.
 */
export function mascararNumero(numero: string | null | undefined): string | null {
  const d = String(numero ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const ddd = d.slice(0, 2);
  const fim = d.slice(-4);
  return `(${ddd}) ${"*".repeat(d.length - 6)}-${fim}`;
}

/** Percentual JA CONSUMIDO da franquia. `null` quando nao ha franquia. */
export function percentualConsumido(restanteGb: number, totalGb: number): number | null {
  if (!Number.isFinite(totalGb) || totalGb <= 0) return null;
  const usado = Math.max(0, totalGb - Math.max(0, restanteGb));
  return Math.min(100, Math.round((usado / totalGb) * 100));
}

/**
 * Digitos verificadores do CPF.
 *
 * O CPF nunca e guardado, mas e digitado pelo admin e vai direto para a
 * operadora. Validar antes evita gastar uma chamada — e, mais importante, um
 * "nao encontrado" que na verdade era erro de digitacao.
 */
export function cpfValido(entrada: string | null | undefined): boolean {
  const cpf = String(entrada ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  for (const [ate, pos] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (pos - i);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== Number(cpf[ate])) return false;
  }
  return true;
}

/**
 * Os nomes batem? Defesa contra o CPF digitado errado.
 *
 * Um digito trocado no cadastro produz uma tela que FUNCIONA — numero, status,
 * consumo, tudo de um estranho, e ninguem desconfia. A operadora devolve o nome
 * do titular junto com as linhas; comparar e praticamente de graca.
 *
 * Compara primeiro + ultimo token, sem acento e sem caixa, para tolerar "Jose
 * da Silva" x "JOSE DA SILVA" e nomes do meio abreviados. Divergiu, recusa —
 * mas **o nome encontrado nunca e mostrado**, senao a tela vira um consultor de
 * "de quem e este CPF".
 */
export function nomesConferem(a: string | null | undefined, b: string | null | undefined): boolean {
  const partes = (s: string | null | undefined) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((p) => p.length > 1);
  const pa = partes(a);
  const pb = partes(b);
  if (!pa.length || !pb.length) return false;
  return pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1];
}
