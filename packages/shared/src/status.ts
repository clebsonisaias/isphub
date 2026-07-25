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

/** Converte um codigo de status do SGP para o enum interno. */
export function mapSgpOsStatus(code: number | string | null | undefined): OsStatus {
  switch (Number(code)) {
    case SgpOsStatus.ABERTA:
      return OsStatus.ABERTA;
    case SgpOsStatus.ENCERRADA:
      return OsStatus.CONCLUIDA;
    case SgpOsStatus.EM_EXECUCAO:
      return OsStatus.EM_EXECUCAO;
    case SgpOsStatus.PENDENTE:
      return OsStatus.PENDENTE;
    default:
      return OsStatus.ABERTA;
  }
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
