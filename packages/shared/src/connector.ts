import type { Endereco } from "./types.js";

/** Credenciais de acesso ao ERP de um provedor. */
export interface ErpCredentials {
  url: string;
  app: string;
  token: string;
}

/** Tipo de OS bruto vindo do ERP (ja normalizado pelo adapter). */
export interface RawOsType {
  sgpCodigo: string;
  descricao: string;
}

/** Tecnico bruto vindo do ERP. */
export interface RawTecnico {
  sgpTecnicoId: string;
  nome: string;
}

/** Ordem de servico normalizada pelo adapter (formato neutro de ERP). */
export interface RawOs {
  sgpOsId: string;
  tipoCodigo?: string | null;
  tipoDescricao?: string | null;
  /** Codigo numerico de status no ERP (mapeado depois por mapSgpOsStatus). */
  statusCode: number;
  prioridade?: number | null;
  clienteNome?: string | null;
  clienteDocumento?: string | null;
  contratoId?: string | null;
  protocolo?: string | null;
  conteudo?: string | null;
  observacao?: string | null;
  endereco: Endereco;
  dataAgendamento?: string | null;
  tecnicoSgpId?: string | null;
  tecnicoNome?: string | null;
}

/** Ocorrencia normalizada pelo adapter. */
export interface RawOccurrence {
  sgpNumero: string;
  tipo?: string | null;
  status?: string | null;
  conteudo?: string | null;
  responsavel?: string | null;
  contratoId?: string | null;
  dataCadastro?: string | null;
  dataAgendamento?: string | null;
}

export interface ListOsParams {
  status?: number;
  motivo?: number[];
  contrato?: number;
  offset?: number;
  limit?: number;
}

export interface ListOccurrenceParams {
  tipo?: number[];
  status?: number;
  offset?: number;
  limit?: number;
}

/**
 * Contrato de integracao com um ERP. Cada ERP (SGP, e futuros) implementa esta
 * interface; o nucleo do ISPhub (sync + write-back) so conhece este contrato,
 * nunca os detalhes de cada API.
 */
export interface ErpConnector {
  /** Valida credenciais fazendo uma chamada leve. */
  testConnection(): Promise<{ ok: boolean; message?: string }>;

  /** Catalogo de tipos de OS/ocorrencia do provedor. */
  listOsTypes(): Promise<RawOsType[]>;

  /** Tecnicos cadastrados no ERP do provedor. */
  listTechnicians(): Promise<RawTecnico[]>;

  /** Lista OS para o espelho (polling). */
  listServiceOrders(params?: ListOsParams): Promise<RawOs[]>;

  /** Lista ocorrencias para o espelho (polling). */
  listOccurrences(params?: ListOccurrenceParams): Promise<RawOccurrence[]>;

  // ---- write-back ----

  /** Marca a OS como "a caminho" (tecnico em deslocamento). */
  setOnTheWay(sgpOsId: string): Promise<void>;

  /** Atualiza o status da OS no ERP (codigo numerico do ERP). */
  updateOsStatus(sgpOsId: string, statusCode: number): Promise<void>;

  /** Adiciona uma anotacao/andamento na OS. */
  addOsNote(sgpOsId: string, texto: string): Promise<void>;
}

/** Fabrica de conector a partir de credenciais (um por provedor). */
export type ErpConnectorFactory = (creds: ErpCredentials) => ErpConnector;
