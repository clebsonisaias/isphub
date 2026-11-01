import { api } from "@/lib/apiClient";

/** O mes do vendedor (ver producaoVendedorService na API). */
export interface ProducaoVendedor {
  mes: string;
  vendasMes: number;
  vendasSemana: number;
  vendasHoje: number;
  agendadasNaHora: number;
  instaladasMes: number;
  ativasMes: number;
  taxaAgendadaNaHora: number;
  meta: number;
  progressoMeta: number;
  faltamParaMeta: number;
  nivel: { atual: string; proximo: string | null; faltamParaProximo: number };
  sequenciaDias: number;
  ranking: { posicao: number; total: number; vendasLider: number; faltamParaLider: number };
  porDia: { dia: string; vendas: number }[];
  conquistas: { id: string; nome: string; descricao: string; desbloqueada: boolean }[];
}

export const producaoVendedorApi = {
  obter: () => api.get<ProducaoVendedor>("/pre-cadastro/producao"),
};
