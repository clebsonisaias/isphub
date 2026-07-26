import type { OsPrioridade, OsStatus } from "./status.js";
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

/**
 * Categoria canonica da ISPhub (global, nao por provedor) — taxonomia unica
 * pra unificar os "motivos"/tipos de OS de cada SGP, que cada provedor nomeia
 * diferente (ex.: "Instalacao" x "Novo cliente" x "Ativacao" sao a mesma
 * categoria em provedores distintos).
 */
export interface Categoria {
  id: string;
  nome: string;
  cor: string;
  /** Nome de icone lucide (ex.: "wrench", "wifi-off"). */
  icone?: string | null;
  /** Palavras-chave (normalizadas) usadas no auto-mapeamento por descricao. */
  palavrasChave: string[];
  /** SLA herdado por tipos mapeados sem SLA proprio definido. */
  slaHorasPadrao?: number | null;
  ordem: number;
  ativo: boolean;
}

/** Vista resumida da categoria, embutida em TipoOs/FilaItem (sem palavrasChave/ativo). */
export type CategoriaResumo = Pick<Categoria, "id" | "nome" | "cor" | "icone" | "slaHorasPadrao">;

/** Tipo de OS/ocorrencia importado do SGP e exibido no ISPhub. */
export interface TipoOs {
  id: string;
  provedorId: string;
  /** Codigo do tipo no SGP. */
  sgpCodigo: string;
  descricao: string;
  /** null = "Nao classificado" (aguardando mapeamento manual ou auto-match). */
  categoriaId: string | null;
  categoria?: CategoriaResumo | null;
  /** Se aparece na fila unificada. */
  visivel: boolean;
  /** Prazo de SLA em horas (base do semaforo). null = sem SLA proprio (usa o padrao da categoria). */
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
  /** null = tipo sem categoria mapeada ainda ("Não classificado"). */
  categoria?: CategoriaResumo | null;
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
  /** Tecnico ISPhub atribuido (despacho feito dentro do ISPhub). */
  tecnicoId?: string | null;
  tecnicoNome?: string | null;
  /** Nome do tecnico designado no SGP do provedor — so informativo, nao e o tecnico ISPhub. */
  tecnicoSgpNome?: string | null;
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

/** Usuario (shape publico, sem hash de senha). Tecnico e um Usuario com role=tecnico. */
export interface UsuarioPublic {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  /** Preenchido apenas para role=provedor. */
  provedorId?: string | null;
  ativo: boolean;
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
  /** "sem_categoria" filtra tipos ainda nao mapeados a nenhuma categoria. */
  categoriaId?: string | "sem_categoria";
  /** Busca livre (cliente, protocolo, endereco). */
  busca?: string;
  /** ISO date range. */
  de?: string;
  ate?: string;
  page?: number;
  pageSize?: number;
}

/** Tipo de evento na timeline de uma OS. */
export type OsEventoTipo = "atribuicao" | "status" | "anotacao" | "foto" | "edicao";

/** Evento da timeline de uma OS (status, anotacao, atribuicao, foto). */
export interface OsEvento {
  id: string;
  tipo: OsEventoTipo;
  autorNome?: string | null;
  descricao: string;
  criadoEm: string;
}

/**
 * Foto de evidencia anexada a uma OS — hospedada no proprio SGP (a ISPhub
 * nao guarda os bytes, so consulta ao vivo). Shape espelha o que o SGP
 * devolve em "Ordem de Servico - Imagens": sem tamanho/mimeType/data, so o
 * que a API de fato expoe.
 */
export interface EvidenciaResumo {
  id: string;
  descricao?: string | null;
  usuario?: string | null;
  arquivo?: string | null;
}

/** Notificacao in-app de um usuario. */
export interface Notificacao {
  id: string;
  tipo: "atribuicao" | "sla_estourado";
  mensagem: string;
  ordemServicoId?: string | null;
  lida: boolean;
  criadoEm: string;
}

/** Metricas agregadas para o dashboard. */
export interface DashboardMetrics {
  totalAbertas: number;
  totalConcluidas: number;
  porProvedor: { provedorId: string; provedorNome: string; cor: string; abertas: number; concluidas: number }[];
  porStatus: { status: OsStatus; total: number }[];
  porCategoria: {
    categoriaId: string | null;
    nome: string;
    cor: string;
    icone?: string | null;
    abertas: number;
    concluidas: number;
  }[];
  porTecnico: { tecnicoId: string; tecnicoNome: string; abertas: number; concluidas: number }[];
  slaEstourado: number;
}
