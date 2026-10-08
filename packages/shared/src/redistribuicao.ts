/**
 * Redistribuir as paradas de quem faltou entre quem esta escalado no turno.
 * Guloso: cada parada vai pra quem tem menos carga; respeita o teto por
 * tecnico quando ha um. O que nao couber volta pra remarcar.
 */
export interface CandidatoRedistribuicao {
  tecnicoId: string;
  /** Paradas que ja tem neste turno. */
  carga: number;
}

export interface PlanoRedistribuicao {
  atribuicoes: { agendamentoId: string; tecnicoId: string }[];
  semDestino: string[];
}

export function planejarRedistribuicao(args: {
  paradas: string[];
  candidatos: CandidatoRedistribuicao[];
  tetoPorTecnico: number | null;
}): PlanoRedistribuicao {
  const carga = new Map(args.candidatos.map((c) => [c.tecnicoId, c.carga]));
  const atribuicoes: PlanoRedistribuicao["atribuicoes"] = [];
  const semDestino: string[] = [];
  for (const agendamentoId of args.paradas) {
    let escolhido: string | null = null;
    let menor = Number.POSITIVE_INFINITY;
    for (const [tecnicoId, c] of carga) {
      if (args.tetoPorTecnico != null && c >= args.tetoPorTecnico) continue;
      if (c < menor) {
        menor = c;
        escolhido = tecnicoId;
      }
    }
    if (!escolhido) {
      semDestino.push(agendamentoId);
      continue;
    }
    atribuicoes.push({ agendamentoId, tecnicoId: escolhido });
    carga.set(escolhido, menor + 1);
  }
  return { atribuicoes, semDestino };
}
