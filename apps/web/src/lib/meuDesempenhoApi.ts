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
  };
  pessoal: {
    osConcluidas: number;
    osConcluidasSemana: number;
    osConcluidasMes: number;
    tempoMedioMinutos: number;
    notaMedia: number;
    totalAvaliacoes: number;
    metaSemanal: number;
    progressoMetaPct: number;
  };
  benchmarksEquipe: {
    liderOs: number;
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
