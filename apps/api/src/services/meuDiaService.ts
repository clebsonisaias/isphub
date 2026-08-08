/**
 * O "MEU DIA" do tecnico: como o dia esta rendendo.
 *
 * Existe porque os contadores do app eram derivados da fila ABERTA em memoria
 * (minhas-os/index.tsx) — e uma lista de abertas, por definicao, nao sabe de
 * concluida. O tecnico terminava seis OS e o numero nao mexia.
 *
 * O corte do dia NAO mora aqui: mora em `@isphub/shared` (`diaBrasileiro`),
 * porque o app precisa cortar igual pra montar a agenda. Ver o comentario de
 * la sobre por que meia-noite UTC seria 21h em Natal.
 */

/** Contagens cruas do dia, como vem do banco. */
export interface ContagensDoDia {
  programadas: number;
  concluidas: number;
  pendentes: number;
  naoRealizadas: number;
}

/**
 * Quanto do dia ja saiu do caminho, em 0..100.
 *
 * Conta CONCLUIDA sobre o total do dia. "Nao realizada" (cliente ausente,
 * cancelada) entra no denominador de proposito: ela consumiu deslocamento e
 * tempo do tecnico. Tira-la faria o numero SUBIR quando o dia deu errado — um
 * indicador que melhora com o fracasso nao serve pra decidir nada.
 */
export function produtividade(c: ContagensDoDia): number {
  const total = c.programadas + c.concluidas + c.pendentes + c.naoRealizadas;
  if (total === 0) return 0;
  return Math.round((c.concluidas / total) * 100);
}
