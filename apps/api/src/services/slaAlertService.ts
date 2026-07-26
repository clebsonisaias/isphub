import { calcularSla } from "./slaService.js";

/** Campos de uma OS necessarios pra decidir se ela deve ser alertada por SLA estourado. */
export interface OsParaAvaliarSla {
  id: string;
  tecnicoId: string | null;
  dataAgendamento: Date | null;
  dataCadastro: Date | null;
  criadoEm: Date;
  /** Ja resolvido: slaHoras do tipo, com fallback pro padrao da categoria. */
  slaHoras: number | null;
}

/**
 * Filtra, dentre OS abertas que ainda nao foram notificadas
 * (`slaNotificadoEm: null`, filtro feito na query do chamador), quais estao
 * com o semaforo vermelho agora — essas sao as que devem gerar notificacao.
 * Funcao pura: sem acesso a banco, testavel com objetos simples.
 */
export function selecionarOsParaAlertar(ordens: OsParaAvaliarSla[], agora: Date): OsParaAvaliarSla[] {
  return ordens.filter((os) => {
    const dataBase = os.dataAgendamento ?? os.dataCadastro ?? os.criadoEm;
    const sla = calcularSla({ slaHoras: os.slaHoras, dataBase, agora });
    return sla.semaforo === "vermelho";
  });
}
