import type { TurnoAgenda } from "@isphub/shared";

/**
 * O que o parceiro (AtendAI) pode ver do andamento de uma OS.
 *
 * Mapeamento puro, separado da rota pra o contrato ser testavel sem banco. A
 * regra que importa: do tecnico sai SO o primeiro nome — o cliente final le
 * isso no WhatsApp, e sobrenome/id de funcionario nao tem por que sair daqui.
 */
export interface OsParaParceiro {
  status: string;
  tecnico: { nome: string } | null;
  tecnicoSgpNome: string | null;
  agendamento: { dia: Date; turno: TurnoAgenda; status: string; ordemRota: number | null } | null;
}

export function primeiroNome(nome: string | null | undefined): string | null {
  return nome?.trim().split(/\s+/)[0] || null;
}

export function montarOsStatus(
  os: OsParaParceiro,
  inicioDoTurno: (dia: string, turno: TurnoAgenda) => Date,
) {
  const a = os.agendamento?.status === "marcado" ? os.agendamento : null;
  const dia = a ? a.dia.toISOString().slice(0, 10) : null;
  return {
    status: os.status,
    tecnicoPrimeiroNome: primeiroNome(os.tecnico?.nome ?? os.tecnicoSgpNome),
    dia,
    turno: a?.turno ?? null,
    inicioEm: a && dia ? inicioDoTurno(dia, a.turno).toISOString() : null,
    ordemRota: a?.ordemRota ?? null,
  };
}
