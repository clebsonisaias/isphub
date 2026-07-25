import type { CategoriaTipoOs, OsPrioridade, OsStatus } from "./status.js";
import type { UserRole } from "./roles.js";

/** ERPs suportados. SGP e o primeiro; outros plugam no mesmo contrato. */
export type ErpTipo = "SGP";

/** Provedor de internet atendido pela ISPhub (tenant). */
export interface Provedor {
  id: string;
  nome: string;
  /** Cor do badge (hex) para destacar a que provedor pertence cada item. */
  cor: string;
  /** URL/base64 do logo (opcional). */
  logoUrl?: string | null;
  ativo: boolean;
  criadoEm: string;
}

/** Configuracao de ERP de um provedor. O token nunca trafega em claro para o front. */
export interface ErpConfigPublic {
  id: string;
  provedorId: string;
  tipo: ErpTipo;
  url: string;
  app: string;
  /** Token mascarado (ex.: "3a4e****aad0"). Nunca o valor real. */
  tokenMascarado: string;
  intervaloPollingSegundos: number;
  ativo: boolean;
  ultimaSyncEm?: string | null;
  ultimaSyncOk?: boolean | null;
  ultimaSyncMensagem?: string | null;
}

/** Tipo de OS/ocorrencia importado do SGP e exibido no ISPhub. */
export interface TipoOs {
  id: string;
  provedorId: string;
  /** Codigo do tipo no SGP. */
  sgpCodigo: string;
  descricao: string;
  categoria: CategoriaTipoOs;
  /** Se aparece na fila unificada. */
  visivel: boolean;
  /** Prazo de SLA em horas (base do semaforo). null = sem SLA definido. */
  slaHoras?: number | null;
}

/** Endereco geolocalizado de uma OS. */
export interface Endereco {
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** Ordem de Servico espelhada do SGP. */
export interface OrdemServico {
  id: string;
  provedorId: string;
  /** ID da OS no SGP. */
  sgpOsId: string;
  tipoOsId?: string | null;
  tipoDescricao?: string | null;
  categoria?: CategoriaTipoOs | null;
  status: OsStatus;
  prioridade: OsPrioridade;
  clienteNome?: string | null;
  clienteDocumento?: string | null;
  contratoId?: string | null;
  protocolo?: string | null;
  conteudo?: string | null;
  observacao?: string | null;
  endereco: Endereco;
  /** Localidade/POP do SGP (ex.: "Macaíba") — nao ha endereco de rua nas listagens do SGP. */
  pop?: string | null;
  /** Status do contrato no SGP (ex.: "Ativo", "Cancelado") — alerta antes de despachar. */
  contratoStatus?: string | null;
  /** Usuario do SGP que registrou a OS. */
  usuario?: string | null;
  /** Data/hora reais de abertura no SGP — distinta de criadoEm (data do 1o sync). */
  dataCadastro?: string | null;
  dataAgendamento?: string | null;
  tecnicoId?: string | null;
  tecnicoNome?: string | null;
  criadoEm: string;
  atualizadoEm: string;
  sincronizadoEm: string;
}

/** Ocorrencia espelhada do SGP. */
export interface Ocorrencia {
  id: string;
  provedorId: string;
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
  sincronizadoEm: string;
}

/** Tecnico (do SGP e/ou usuario interno). */
export interface Tecnico {
  id: string;
  nome: string;
  sgpTecnicoId?: string | null;
  provedorId?: string | null;
  ativo: boolean;
}

/** Usuario autenticado (shape publico, sem hash de senha). */
export interface UsuarioPublic {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  /** Preenchido apenas para role=provedor. */
  provedorId?: string | null;
}

/** Semaforo de SLA calculado no servidor. */
export type SlaSemaforo = "verde" | "amarelo" | "vermelho" | "sem_sla";

export interface SlaInfo {
  semaforo: SlaSemaforo;
  /** Minutos restantes ate o vencimento (negativo = estourado). */
  minutosRestantes?: number | null;
  vencimentoEm?: string | null;
}

/**
 * Item da fila unificada. Uniao discriminada entre OS e ocorrencia, sempre
 * carregando o provedor (com cor/logo) para o badge e o SLA calculado.
 */
export type FilaItem =
  | ({ kind: "os"; provedor: Provedor; sla: SlaInfo } & OrdemServico)
  | ({ kind: "ocorrencia"; provedor: Provedor } & Ocorrencia);

/** Filtros da fila unificada (query params da API). */
export interface FilaFiltros {
  provedorId?: string;
  status?: OsStatus[];
  tipoOsId?: string;
  tecnicoId?: string;
  categoria?: CategoriaTipoOs;
  /** Busca livre (cliente, protocolo, endereco). */
  busca?: string;
  /** ISO date range. */
  de?: string;
  ate?: string;
  page?: number;
  pageSize?: number;
}

/** Metricas agregadas para o dashboard. */
export interface DashboardMetrics {
  totalAbertas: number;
  totalConcluidas: number;
  porProvedor: { provedorId: string; provedorNome: string; cor: string; abertas: number; concluidas: number }[];
  porStatus: { status: OsStatus; total: number }[];
  porCategoria: { categoria: CategoriaTipoOs | "sem_categoria"; abertas: number; concluidas: number }[];
  porTecnico: { tecnicoId: string; tecnicoNome: string; abertas: number; concluidas: number }[];
  slaEstourado: number;
}
