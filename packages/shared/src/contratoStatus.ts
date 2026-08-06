import { UserRole } from "./roles.js";

/**
 * STATUS DE CONTRATO NO SGP — leitura, escrita e quem pode mudar o quê.
 *
 * O ISPhub guarda `OrdemServico.contratoStatus` como TEXTO CRU do SGP ("Ativo",
 * "Contrato Inativo", "Ativo V. Reduzida", "Suspenso"). Pra escrever de volta o
 * SGP quer um INTEIRO. Este arquivo faz a ponte nos dois sentidos e decide a
 * transicao.
 *
 * ---------------------------------------------------------------------------
 * O ENUM AQUI E O DO REST, NAO O DO BANCO
 *
 * O SGP tem DOIS conjuntos de inteiros pra status de contrato, e eles nao
 * coincidem. No REST (`/api/ura/contrato/status/edit/`) `3 = Cancelado`; na
 * coluna `admcore_clientecontratostatus.status` do banco dele, `5 = Cancelado`.
 * Escrever o numero do banco no REST muda o contrato pro status errado sem
 * nenhum erro. Estes sao os do REST.
 * ---------------------------------------------------------------------------
 */

export const STATUS_CONTRATO = {
  1: "Ativo",
  2: "Inativo",
  3: "Cancelado",
  4: "Suspenso",
  5: "Inviabilidade técnica",
  6: "Novo",
  7: "Velocidade reduzida",
} as const;

export type CodigoStatusContrato = keyof typeof STATUS_CONTRATO;

export const CODIGOS_STATUS_CONTRATO = [1, 2, 3, 4, 5, 6, 7] as const;

export function ehCodigoStatusContrato(v: unknown): v is CodigoStatusContrato {
  return typeof v === "number" && (CODIGOS_STATUS_CONTRATO as readonly number[]).includes(v);
}

/** minusculas, sem acento, espacos colapsados. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Texto cru do SGP -> codigo REST. `null` quando nao da pra afirmar.
 *
 * ---------------------------------------------------------------------------
 * A ARMADILHA: "inativo" CONTEM "ativo".
 *
 * Um `texto.includes("ativo")` casa com "Contrato Inativo" e responde ATIVO —
 * liberando o tecnico exatamente no caso que ele deveria poder mexer, mas pelo
 * motivo errado, e travando-o depois que a reativacao funcionou. Pior: casa
 * tambem com "Ativo V. Reduzida", que NAO e um contrato normal.
 *
 * Por isso o casamento e por PALAVRA inteira, sobre o texto normalizado, e a
 * ordem importa — "inativo" e testado antes de "ativo".
 * ---------------------------------------------------------------------------
 *
 * `null` (texto desconhecido) e resposta legitima: cada SGP nomeia do seu jeito,
 * e inventar um codigo pra texto que ninguem reconhece escreveria status errado
 * no ERP do provedor. Quem consome trata `null` como "nao mexe" (fail-closed).
 */
export function codigoDoTexto(texto: string | null | undefined): CodigoStatusContrato | null {
  if (!texto) return null;
  const t = normalizar(texto);
  const tem = (palavra: string) => new RegExp(`\\b${palavra}\\b`).test(t);

  // Reduzida antes de tudo: "Ativo V. Reduzida" tem a palavra "ativo" e NAO e
  // um contrato normal — e velocidade reduzida por inadimplencia.
  if (tem("reduzida") || tem("reduzido")) return 7;
  // Inativo antes de ativo: sao palavras diferentes, mas so o \b separa.
  if (tem("inativo") || tem("inativa")) return 2;
  if (tem("cancelado") || tem("cancelada")) return 3;
  if (tem("suspenso") || tem("suspensa")) return 4;
  if (tem("inviabilidade") || tem("inviavel")) return 5;
  if (tem("novo") || tem("nova")) return 6;
  if (tem("ativo") || tem("ativa")) return 1;
  return null;
}

export function rotuloDoTexto(texto: string | null | undefined): string {
  const codigo = codigoDoTexto(texto);
  // Texto desconhecido continua sendo exibido como veio: esconder o que o SGP
  // disse seria pior do que mostrar um rotulo que nao esta na nossa lista.
  return codigo ? STATUS_CONTRATO[codigo] : (texto?.trim() || "—");
}

/** O contrato esta INATIVO? E a unica origem que o tecnico pode mexer. */
export function ehInativo(texto: string | null | undefined): boolean {
  return codigoDoTexto(texto) === 2;
}

/** O contrato esta ATIVO (normal)? Velocidade reduzida NAO conta. */
export function ehAtivo(texto: string | null | undefined): boolean {
  return codigoDoTexto(texto) === 1;
}

// ---------------------------------------------------------------------------
// Quem pode mudar o quê
// ---------------------------------------------------------------------------

/**
 * As unicas transicoes que um TECNICO pode fazer: Inativo -> Ativo.
 *
 * Ao pe da letra, por decisao do dono. Consequencia a saber: contrato cortado
 * por inadimplencia costuma aparecer como SUSPENSO, nao inativo — o tecnico nao
 * religa esse caso nem com o cliente tendo acabado de pagar. Se um dia isso
 * mudar, e uma entrada nesta lista, nao um redesenho.
 */
export const TRANSICOES_TECNICO: ReadonlyArray<{ de: CodigoStatusContrato; para: CodigoStatusContrato }> = [
  { de: 2, para: 1 },
];

/** Papeis que mudam para QUALQUER status, a qualquer hora. */
const PAPEIS_LIVRES: readonly UserRole[] = [UserRole.ADMIN, UserRole.GESTOR];

export type MotivoRecusa =
  | "papel_sem_permissao"
  | "status_atual_desconhecido"
  | "transicao_nao_permitida"
  | "sem_mudanca";

export type ResultadoTransicao = { permitido: true } | { permitido: false; motivo: MotivoRecusa };

/**
 * Pode ir de `de` para `para`, com este papel?
 *
 * `de` e o texto CRU do SGP de proposito: quem chama tem o texto, nao o codigo,
 * e converter no meio do caminho e onde a armadilha do "inativo" se esconde.
 */
export function transicaoPermitida(
  role: UserRole,
  de: string | null | undefined,
  para: CodigoStatusContrato,
): ResultadoTransicao {
  const atual = codigoDoTexto(de);

  /*
   * O PAPEL E TESTADO PRIMEIRO, antes de "ja esta nesse status".
   *
   * A ordem inversa respondia "sem_mudanca" pra um provedor pedindo Inativo num
   * contrato inativo — uma recusa que sugere "tente outro status" a quem nunca
   * vai poder mudar nenhum. O bloqueio fundamental e o papel; a igualdade de
   * status e detalhe de quem JA tem permissao.
   */
  if (!PAPEIS_LIVRES.includes(role) && role !== UserRole.TECNICO) {
    return { permitido: false, motivo: "papel_sem_permissao" };
  }

  if (atual === para) return { permitido: false, motivo: "sem_mudanca" };

  // Admin e supervisor: qualquer status, a qualquer hora — inclusive quando o
  // texto do SGP e desconhecido, porque ai justamente e que alguem precisa
  // corrigir o contrato pra um valor conhecido.
  if (PAPEIS_LIVRES.includes(role)) return { permitido: true };

  // Daqui pra baixo e tecnico. FAIL-CLOSED: sem saber de onde parte, nao anda.
  if (atual === null) return { permitido: false, motivo: "status_atual_desconhecido" };

  const ok = TRANSICOES_TECNICO.some((t) => t.de === atual && t.para === para);
  return ok ? { permitido: true } : { permitido: false, motivo: "transicao_nao_permitida" };
}

/** Os status que este papel pode ESCOLHER, dado o status atual — pra montar a UI. */
export function alvosPermitidos(role: UserRole, de: string | null | undefined): CodigoStatusContrato[] {
  return CODIGOS_STATUS_CONTRATO.filter((c) => transicaoPermitida(role, de, c).permitido);
}

export const MOTIVO_RECUSA_TEXTO: Record<MotivoRecusa, string> = {
  papel_sem_permissao: "Seu perfil não altera status de contrato.",
  status_atual_desconhecido: "O status atual do contrato não foi reconhecido — peça a um supervisor.",
  transicao_nao_permitida: "Técnico só reativa contrato inativo. Peça a um supervisor.",
  sem_mudanca: "O contrato já está nesse status.",
};
