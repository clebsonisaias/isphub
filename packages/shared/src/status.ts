/**
 * Status interno de uma Ordem de Servico no ISPhub.
 *
 * O SGP usa codigos numericos (0=Aberta, 1=Encerrada, 2=Em execucao, 3=Pendente).
 * O ISPhub trabalha com um enum semantico mais rico, incluindo estados que so
 * existem no fluxo de campo (em_deslocamento) ou que o SGP nao expoe diretamente
 * (cancelada). O mapeamento de/para o SGP fica centralizado aqui.
 */
export enum OsStatus {
  ABERTA = "aberta",
  EM_DESLOCAMENTO = "em_deslocamento",
  EM_EXECUCAO = "em_execucao",
  CONCLUIDA = "concluida",
  CANCELADA = "cancelada",
  PENDENTE = "pendente",
}

/** Codigos de status de OS no SGP. */
export enum SgpOsStatus {
  ABERTA = 0,
  ENCERRADA = 1,
  EM_EXECUCAO = 2,
  PENDENTE = 3,
}

/** Prioridade de OS no SGP (tambem usada internamente). */
export enum OsPrioridade {
  BAIXA = 1,
  NORMAL = 2,
  ALTA = 3,
}

/**
 * Converte o status cru do SGP para o enum interno. Aceita tanto o codigo
 * numerico (`status_id`) quanto o rotulo textual (`status`), porque
 * instancias reais do SGP mandam os dois campos — e um payload que so tinha
 * o texto ja fez Number() virar NaN e cair no fallback "Aberta", marcando
 * toda OS como aberta indefinidamente (inclusive as encerradas).
 */
export function mapSgpOsStatus(code: number | string | null | undefined): OsStatus {
  const numero = typeof code === "number" ? code : Number(String(code ?? "").trim());
  if (Number.isFinite(numero)) {
    switch (numero) {
      case SgpOsStatus.ABERTA:
        return OsStatus.ABERTA;
      case SgpOsStatus.ENCERRADA:
        return OsStatus.CONCLUIDA;
      case SgpOsStatus.EM_EXECUCAO:
        return OsStatus.EM_EXECUCAO;
      case SgpOsStatus.PENDENTE:
        return OsStatus.PENDENTE;
    }
  }

  // Rotulo textual (ex.: "Encerrada", "Em execução"). Comparado sem acento
  // e por prefixo/trecho, porque a grafia varia entre instancias do SGP.
  const texto = String(code ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remove acentos
  if (!texto) return OsStatus.ABERTA;
  if (texto.startsWith("encerrad") || texto.startsWith("finalizad") || texto.startsWith("concluid")) {
    return OsStatus.CONCLUIDA;
  }
  if (texto.startsWith("cancelad")) return OsStatus.CANCELADA;
  if (texto.includes("execu")) return OsStatus.EM_EXECUCAO;
  if (texto.startsWith("pendent")) return OsStatus.PENDENTE;
  if (texto.startsWith("abert")) return OsStatus.ABERTA;

  // Desconhecido: assume aberta pra nao sumir da fila operacional. Quem
  // sincroniza deve avisar (ver sgpStatusReconhecido) — silenciar isso foi
  // o que escondeu o bug do status textual por tanto tempo.
  return OsStatus.ABERTA;
}

/**
 * Se o status cru do SGP casou com alguma regra conhecida de mapSgpOsStatus.
 * `false` significa que o valor caiu no fallback "aberta" sem ser entendido —
 * o sync usa isso pra logar e nao mascarar formato novo/inesperado.
 */
export function sgpStatusReconhecido(code: number | string | null | undefined): boolean {
  const numero = typeof code === "number" ? code : Number(String(code ?? "").trim());
  if (Number.isFinite(numero)) {
    return [SgpOsStatus.ABERTA, SgpOsStatus.ENCERRADA, SgpOsStatus.EM_EXECUCAO, SgpOsStatus.PENDENTE].includes(numero);
  }
  const texto = String(code ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!texto) return false;
  return (
    texto.startsWith("encerrad") ||
    texto.startsWith("finalizad") ||
    texto.startsWith("concluid") ||
    texto.startsWith("cancelad") ||
    texto.includes("execu") ||
    texto.startsWith("pendent") ||
    texto.startsWith("abert")
  );
}

/**
 * Converte o status interno para o codigo do SGP usado no write-back.
 * Estados sem equivalente direto (em_deslocamento) retornam undefined e devem
 * ser tratados por endpoint especifico (ex.: /api/os/acaminho/).
 */
export function toSgpOsStatus(status: OsStatus): SgpOsStatus | undefined {
  switch (status) {
    case OsStatus.ABERTA:
      return SgpOsStatus.ABERTA;
    case OsStatus.CONCLUIDA:
      return SgpOsStatus.ENCERRADA;
    case OsStatus.CANCELADA:
      return SgpOsStatus.ENCERRADA; // SGP nao tem "cancelada"; encerra a OS
    case OsStatus.EM_EXECUCAO:
      return SgpOsStatus.EM_EXECUCAO;
    case OsStatus.PENDENTE:
      return SgpOsStatus.PENDENTE;
    case OsStatus.EM_DESLOCAMENTO:
      return undefined;
    default:
      return undefined;
  }
}

/** Rotulo legivel (pt-BR) para exibicao. */
export const OS_STATUS_LABEL: Record<OsStatus, string> = {
  [OsStatus.ABERTA]: "Aberta",
  [OsStatus.EM_DESLOCAMENTO]: "A caminho",
  [OsStatus.EM_EXECUCAO]: "Em execucao",
  [OsStatus.CONCLUIDA]: "Concluida",
  [OsStatus.CANCELADA]: "Cancelada",
  [OsStatus.PENDENTE]: "Pendente",
};

/** Status que ainda demandam acao (usado para filtrar a fila "abertas"). */
export const OS_STATUS_ABERTOS: OsStatus[] = [
  OsStatus.ABERTA,
  OsStatus.EM_DESLOCAMENTO,
  OsStatus.EM_EXECUCAO,
  OsStatus.PENDENTE,
];
