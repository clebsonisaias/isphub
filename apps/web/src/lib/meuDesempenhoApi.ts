import { api } from "@/lib/apiClient";

export interface MeuDesempenhoDto {
  periodo: "semana" | "mes";
  inicioPeriodo: string;
  fimPeriodo: string;
  ranking: {
    posicao: number;
    totalTecnicos: number;
    titulo: string;
    diferencaParaLider: number;
    liderPontos: number;
  };
  pessoal: {
    pontos: number;
    osIndividual: number;
    osDupla: number;
    osConcluidas: number;
    osConcluidasSemana: number;
    osConcluidasMes: number;
    pontosSemana: number;
    pontosMes: number;
    tempoMedioMinutos: number;
    notaMedia: number;
    totalAvaliacoes: number;
    metaSemanal: number;
    progressoMetaPct: number;
  };
  benchmarksEquipe: {
    liderPontos: number;
    liderOs: number;
    mediaEquipePontos: number;
    mediaEquipeOs: number;
    tempoMedioEquipeMin: number;
  };
  insignias: Array<{
    id: string;
    nome: string;
    descricao: string;
    icone: string;
    desbloqueada: boolean;
  }>;
}

export const meuDesempenhoApi = {
  obter: (periodo: "semana" | "mes" = "semana") =>
    api.get<MeuDesempenhoDto>(`/produtividade/meu-desempenho?periodo=${periodo}`),
};
