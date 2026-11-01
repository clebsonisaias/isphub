import type { TurnoAgenda } from "@isphub/shared";
import { api } from "./apiClient";

export interface PlanoZona {
  plano_id?: number;
  nome: string;
  velocidade: string | null;
  unidade: string;
  valor: number | null;
  beneficios: string[];
  destaque: boolean;
}

/** A resposta do `verificar_cobertura` do AtendAI, repassada pelo ISPhub. */
export interface CoberturaResposta {
  status: string;
  tratarComoCoberto: boolean;
  zona?: { id: string; nome: string } | null;
  cidade?: string | null;
  local?: { bairro: string | null; cidade: string | null } | null;
  lat?: number | null;
  lng?: number | null;
  popId?: number | null;
  portadorId?: number | null;
  nasId?: number | null;
  planos: PlanoZona[];
  zonaMaisProxima?: { nome: string; distanciaKm: number } | null;
}

export interface FormularioEnvio {
  nome: string;
  cpfCnpj: string;
  nascimento?: string | null;
  celular?: string | null;
  email?: string | null;
  plano: { id: number; nome: string };
  vencimentoDia: number;
  logradouro: string;
  numero?: string | null;
  complemento?: string | null;
  referencia?: string | null;
  bairro: string;
  cidade: string;
  cep?: string | null;
  popId?: number | null;
  portadorId?: number | null;
  nasId?: number | null;
}

export interface PreCadastro {
  id: string;
  clienteNome: string;
  cidade: string | null;
  plano: string | null;
  protocolo: string | null;
  contratoId: string | null;
  sgpOsId: string | null;
  status: "enviado" | "os_encontrada" | "agendado";
  criadoEm: string;
}

export type BuscaOs =
  | { encontrada: false }
  | { encontrada: true; sgpOsId: string; vagas: { dia: string; turno: TurnoAgenda; livres: number }[] };

export const preCadastroApi = {
  cobertura: (q: { lat?: number; lng?: number; cep?: string; endereco?: string }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v != null && v !== "") p.set(k, String(v));
    return api.get<CoberturaResposta>(`/pre-cadastro/cobertura?${p}`);
  },
  vencimentos: () => api.get<{ dias: number[] }>("/pre-cadastro/vencimentos"),
  enviar: (f: FormularioEnvio) => api.post<PreCadastro>("/pre-cadastro", f),
  listar: () => api.get<PreCadastro[]>("/pre-cadastro"),
  os: (id: string) => api.get<BuscaOs>(`/pre-cadastro/${id}/os`),
  agendar: (id: string, dia: string, turno: TurnoAgenda) =>
    api.post<{ dia: string; turno: TurnoAgenda }>(`/pre-cadastro/${id}/agendar`, { dia, turno }),
};
