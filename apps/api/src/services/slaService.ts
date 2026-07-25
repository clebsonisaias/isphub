import type { SlaInfo, SlaSemaforo } from "@isphub/shared";

/**
 * Calcula o semaforo de SLA de uma OS.
 *
 * Regra: prazo = dataBase + slaHoras. Vermelho se ja estourou; amarelo nos
 * ultimos 25% do prazo (urgencia); verde caso contrario. Sem slaHoras ou
 * sem dataBase => "sem_sla" (tipo de OS sem prazo definido pelo Admin).
 */
export function calcularSla(params: {
  slaHoras: number | null | undefined;
  dataBase: Date | null | undefined;
  agora?: Date;
}): SlaInfo {
  const { slaHoras, dataBase } = params;
  if (!slaHoras || !dataBase) {
    return { semaforo: "sem_sla" };
  }

  const agora = params.agora ?? new Date();
  const vencimento = new Date(dataBase.getTime() + slaHoras * 60 * 60 * 1000);
  const minutosRestantes = Math.round((vencimento.getTime() - agora.getTime()) / 60_000);
  const limiarAmarelo = slaHoras * 60 * 0.25; // ultimos 25% do prazo

  let semaforo: SlaSemaforo;
  if (minutosRestantes < 0) semaforo = "vermelho";
  else if (minutosRestantes <= limiarAmarelo) semaforo = "amarelo";
  else semaforo = "verde";

  return { semaforo, minutosRestantes, vencimentoEm: vencimento.toISOString() };
}
