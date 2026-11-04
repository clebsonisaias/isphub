import { api } from "./apiClient";

export interface EnderecoCep {
  cep: string;
  logradouro: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  estado: string;
  ibge?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface ResultadoCep {
  ok: boolean;
  provedor: "brasilapi" | "viacep" | "cache";
  endereco: EnderecoCep;
}

export const integracoesApi = {
  consultarCep: async (cep: string): Promise<ResultadoCep | null> => {
    const limpo = cep.replace(/\D/g, "");
    if (limpo.length !== 8) return null;
    try {
      return await api.get<ResultadoCep>(`/integracoes/cep/${limpo}`);
    } catch {
      return null;
    }
  },

  listarUfs: async () => {
    return api.get<{ ok: boolean; ufs: { id: number; sigla: string; nome: string }[] }>("/integracoes/ibge/ufs");
  },

  listarMunicipios: async (uf: string) => {
    return api.get<{ ok: boolean; uf: string; municipios: { id: number; nome: string }[] }>(
      `/integracoes/ibge/municipios/${encodeURIComponent(uf)}`,
    );
  },
};
