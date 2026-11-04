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
  provedor: "brasilapi" | "viacep" | "cache";
  endereco: EnderecoCep;
}

export interface UfIbge {
  id: number;
  sigla: string;
  nome: string;
}

export interface MunicipioIbge {
  id: number;
  nome: string;
}

export interface FeriadoNacional {
  date: string;
  name: string;
  type: string;
}
