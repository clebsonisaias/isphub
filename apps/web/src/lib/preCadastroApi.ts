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
  /** Endereco do ponto (geocodificacao do AtendAI) — pre-preenche o cadastro. */
  local?: {
    bairro: string | null;
    cidade: string | null;
    logradouro?: string | null;
    cep?: string | null;
    /** A rua tem mais de um CEP e o bairro nao decidiu: a vendedora escolhe. */
    candidatosCep?: { cep: string; bairro: string }[];
  } | null;
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

/**
 * `provedorId`: so a gestao (admin/gestor) informa — o vendedor esta preso ao
 * provedor dele e a API ignora o campo para ele.
 */
export const preCadastroApi = {
  cobertura: (q: { lat?: number; lng?: number; cep?: string; endereco?: string }, provedorId?: string | null) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...q, provedorId })) if (v != null && v !== "") p.set(k, String(v));
    return api.get<CoberturaResposta>(`/pre-cadastro/cobertura?${p}`);
  },
  vencimentos: (provedorId?: string | null) =>
    api.get<{ dias: number[] }>(`/pre-cadastro/vencimentos${provedorId ? `?provedorId=${encodeURIComponent(provedorId)}` : ""}`),
  enviar: (f: FormularioEnvio, provedorId?: string | null) => api.post<PreCadastro>("/pre-cadastro", { ...f, ...(provedorId ? { provedorId } : {}) }),
  listar: () => api.get<PreCadastro[]>("/pre-cadastro"),
  os: (id: string) => api.get<BuscaOs>(`/pre-cadastro/${id}/os`),
  /** Abre (ou retoma) a conversa com o cliente pelo WhatsApp oficial do provedor. */
  conversa: (id: string) => api.post<{ conversaId: string }>(`/pre-cadastro/${id}/conversa`, {}),
  agendar: (id: string, dia: string, turno: TurnoAgenda) =>
    api.post<{ dia: string; turno: TurnoAgenda }>(`/pre-cadastro/${id}/agendar`, { dia, turno }),
};
