import type { VagaTurno } from "@isphub/shared";

/**
 * Cor da célula de um turno da agenda. Só a urgência recebe cor — o resto fica
 * neutro. Vale pra grade da Agenda e pra faixa da semana no Dashboard.
 */
export function tomDaVaga(v: VagaTurno) {
  // Feriado é neutro, não vermelho: nada deu errado, o dia só não existe.
  if (v.bloqueio === "feriado") return "bg-muted/40 text-muted-foreground";
  if (v.bloqueio === "dia_nao_atendido") return "bg-muted/40 text-muted-foreground";
  if (v.bloqueio === "turno_nao_atendido") return "bg-muted/40 text-muted-foreground";
  if (v.bloqueio === "antecedencia") return "bg-muted/40 text-muted-foreground";
  // Sem equipe e acionavel (escalar alguem abre a vaga): ambar, nao vermelho.
  if (v.bloqueio === "sem_equipe") return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  if (v.bloqueio) return "bg-destructive/15 text-destructive";
  if (v.livres <= 3) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-background";
}

export function textoBloqueio(v: VagaTurno) {
  switch (v.bloqueio) {
    case "lotado":
      return "Turno lotado";
    case "dia_lotado":
      // Não diz "turno": o dia inteiro fechou, e mandar tentar o outro turno
      // do mesmo dia só produziria a mesma recusa de novo.
      return "Dia lotado";
    case "regiao":
      return "Limite da região";
    case "feriado":
      // O motivo, não a palavra "feriado": um dia que some sem explicação vira
      // pergunta interna sobre por que sumiu.
      return v.motivoBloqueio ?? "Feriado";
    case "dia_nao_atendido":
      return "Sem atendimento";
    case "turno_nao_atendido":
      return "Só manhã";
    case "sem_equipe":
      return "Sem equipe escalada";
    case "antecedencia":
      return "Prazo curto";
    default:
      return `${v.livres} livre${v.livres === 1 ? "" : "s"}`;
  }
}

/** Bloqueio de CALENDÁRIO: o turno não existe, então não há rota pra abrir. */
export function fechadoNoCalendario(v: VagaTurno) {
  return v.bloqueio === "feriado" || v.bloqueio === "dia_nao_atendido" || v.bloqueio === "turno_nao_atendido";
}
