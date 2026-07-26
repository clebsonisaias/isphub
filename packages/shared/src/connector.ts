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
  contratoStatus?: string | null;
  protocolo?: string | null;
  conteudo?: string | null;
  observacao?: string | null;
  endereco: Endereco;
  pop?: string | null;
  usuario?: string | null;
  dataCadastro?: string | null;
  dataAgendamento?: string | null;
  /** Nome do tecnico designado no SGP (pessoal do provedor) — so informativo. */
  tecnicoSgpNome?: string | null;
}

/** Ocorrencia normalizada pelo adapter. */
export interface RawOccurrence {
  sgpNumero: string;
  tipo?: string | null;
  status?: string | null;
  conteudo?: string | null;
  responsavel?: string | null;
  clienteNome?: string | null;
  contratoId?: string | null;
  contratoStatus?: string | null;
  pop?: string | null;
  metodo?: string | null;
  usuario?: string | null;
  dataCadastro?: string | null;
  dataAgendamento?: string | null;
  dataFinalizacao?: string | null;
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

/** Status de conexao consultado ao vivo no ERP (nao faz parte do sync em massa). */
export interface ConnectionStatus {
  /** null = indeterminado (ERP nao respondeu com um sinal claro de online/offline). */
  online: boolean | null;
  /** Mensagem original do ERP (ex.: "Serviço Offline"), mostrada ao usuario. */
  mensagem: string | null;
}

/**
 * Detalhes tecnicos consultados ao vivo no ERP (endereco completo + sinal
 * da ONU + status de conexao) — nao fazem parte do sync em massa porque o
 * SGP nao expoe endereco de rua nem sinal nas listagens de OS/ocorrencia,
 * so num endpoint de consulta de cliente separado.
 */
export interface DetalhesTecnicos {
  endereco: Endereco | null;
  online: boolean | null;
  /** Potencia optica recebida pela ONU, em dBm (valores normais: -8 a -27; abaixo disso indica problema no sinal). */
  sinalRxDbm: number | null;
  /** Potencia optica transmitida pela ONU, em dBm. */
  sinalTxDbm: number | null;
  oltNome: string | null;
  mensagem: string | null;
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

  // ---- consultas ao vivo (sob demanda, fora do sync em massa) ----

  /** Verifica se o servico do contrato esta online/offline agora. */
  checkConnectionStatus(contratoId: string): Promise<ConnectionStatus>;

  /** Endereco completo + sinal da ONU + conexao do contrato, direto do cadastro do cliente. */
  getDetalhesTecnicos(contratoId: string): Promise<DetalhesTecnicos>;
}

/** Fabrica de conector a partir de credenciais (um por provedor). */
export type ErpConnectorFactory = (creds: ErpCredentials) => ErpConnector;
