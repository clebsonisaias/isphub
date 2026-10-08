import type { TurnoAgenda, VagaTurno } from "./agenda.js";
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
  /**
   * true = OS desta categoria sao executadas por equipe de FORA (nao a da
   * ISPhub) — ex.: retirada/cancelamento. Saem da fila/mapa/alertas de SLA e
   * ganham tela propria (ver EquipeFiltro).
   */
  equipeExterna: boolean;
  ordem: number;
  ativo: boolean;
}

/**
 * Quem executa a OS: a equipe da ISPhub ("interna") ou uma equipe de fora
 * ("externa" — retirada/cancelamento), derivado de Categoria.equipeExterna.
 * "todas" e um escape hatch de auditoria (nao exposto na UI).
 */
export type EquipeFiltro = "interna" | "externa" | "todas";

/**
 * Vista resumida da categoria, embutida em TipoOs/FilaItem (sem palavrasChave/ativo).
 *
 * `equipeExterna` entra aqui porque o cliente precisa DISTINGUIR retirada de
 * serviço da casa sem uma segunda consulta — o mapa desenha as duas juntas e
 * com marcador diferente.
 */
export type CategoriaResumo = Pick<
  Categoria,
  "id" | "nome" | "cor" | "icone" | "slaHorasPadrao" | "equipeExterna"
>;

/** Tipo de OS importado do SGP e exibido no ISPhub. */
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
  /** Telefone/contato do cliente (do cadastro no SGP) — não vem na listagem de OS. */
  telefone?: string | null;
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
  /**
   * A posicao desta parada na rota do dia, definida pelo supervisor na agenda.
   * Nulo = ainda nao roteirizada. Ver `turnoAgenda`.
   */
  ordemRota?: number | null;
  /** A metade do dia em que a visita foi marcada na agenda da ISPhub. */
  turnoAgenda?: TurnoAgenda | null;
  /** `AAAA-MM-DD` da visita marcada na agenda da ISPhub. Nulo = sem marcacao ativa. */
  diaAgenda?: string | null;
  /** Id da marcacao ativa — e o que `DELETE /agenda/:id` (desmarcar) espera. */
  agendamentoId?: string | null;
  /** Quando o CLIENTE confirmou a visita (lembrete). Nulo = ainda nao respondeu. */
  visitaConfirmadaEm?: string | null;
  /** Quando o SGP do provedor refletiu a data marcada. Nulo = pendente la. */
  visitaSgpConfirmadaEm?: string | null;
  /** Tecnico ISPhub atribuido (despacho feito dentro do ISPhub). */
  tecnicoId?: string | null;
  tecnicoNome?: string | null;
  /** Nome do tecnico designado no SGP do provedor — so informativo, nao e o tecnico ISPhub. */
  tecnicoSgpNome?: string | null;
  criadoEm: string;
  atualizadoEm: string;
  sincronizadoEm: string;
}

/**
 * Status manual que o proprio usuario define no perfil — sibling da presenca
 * automatica (`online`, calculada de ultimaAtividadeEm), nunca a substitui.
 */
export enum StatusPreset {
  DISPONIVEL = "disponivel",
  EM_CAMPO = "em_campo",
  ALMOCO = "almoco",
  INDISPONIVEL = "indisponivel",
}

export const STATUS_PRESET_LABEL: Record<StatusPreset, string> = {
  [StatusPreset.DISPONIVEL]: "Disponível",
  [StatusPreset.EM_CAMPO]: "Em campo",
  [StatusPreset.ALMOCO]: "Almoço",
  [StatusPreset.INDISPONIVEL]: "Indisponível",
};

/** Usuario (shape publico, sem hash de senha). Tecnico e um Usuario com role=tecnico. */
export interface UsuarioPublic {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  /** Preenchido apenas para role=provedor. */
  provedorId?: string | null;
  ativo: boolean;
  /** Foto de perfil: nunca os bytes, so a existencia + versao (cache-busting). */
  temFoto: boolean;
  fotoVersao: number;
  status?: StatusPreset | null;
  statusTexto?: string | null;
  /** Apelido editavel exibido no chat/UI — `nome` continua fixo (cadastro). */
  nomeExibicao?: string | null;
  bio?: string | null;
  /** Distinto das credenciais de login (email/senha). */
  telefoneContato?: string | null;
  /** Anexada as mensagens deste usuario no chat interno. */
  assinaturaChat?: string | null;
  /** Hex "#rrggbb" — pessoal, nao confundir com Provedor.cor. */
  corDestaque?: string | null;
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
 * Item da fila. Uma Ordem de Servico espelhada, sempre carregando o provedor
 * (com cor/logo) para o badge e o SLA calculado no servidor. A ISPhub trabalha
 * so com OS — ocorrencias foram removidas do sistema.
 */
export type FilaItem = { provedor: Provedor; sla: SlaInfo } & OrdemServico;

/** Filtros da fila unificada (query params da API). */
export interface FilaFiltros {
  provedorId?: string;
  status?: OsStatus[];
  tipoOsId?: string;
  tecnicoId?: string;
  /** "sem_categoria" filtra tipos ainda nao mapeados a nenhuma categoria. */
  categoriaId?: string | "sem_categoria";
  /** Separa fila operacional ("abertos") do arquivo ("fechados"). */
  grupo?: "abertos" | "fechados";
  /** Quem executa a OS. Default do servidor: "interna" (fila da equipe ISPhub). */
  equipe?: EquipeFiltro;
  /** Busca livre (cliente, protocolo, endereco). */
  busca?: string;
  /** ISO date range (sobre `dataAgendamento` do SGP). */
  de?: string;
  ate?: string;
  /** `AAAA-MM-DD`: so OS com visita MARCADA na agenda ISPhub neste dia. */
  diaAgenda?: string;
  page?: number;
  pageSize?: number;
}

/** Tipo de evento na timeline de uma OS. */
/** `contrato` = mudanca do status do CONTRATO (nao da OS) feita a partir dela. */
export type OsEventoTipo = "atribuicao" | "status" | "anotacao" | "foto" | "edicao" | "contrato";

/** Evento da timeline de uma OS (status, anotacao, atribuicao, foto). */
export interface OsEvento {
  id: string;
  tipo: OsEventoTipo;
  autorNome?: string | null;
  descricao: string;
  criadoEm: string;
  /** Onde o tecnico estava. Nulo quando a permissao foi negada. */
  lat?: number | null;
  lng?: number | null;
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
  /** "mensagem" = chat generico; "mencao" = "@fulano" numa mensagem que cita este usuario. */
  /** `frota_alerta` cobre os quatro da frota — o QUE houve vai no texto, junto
   * com a placa, porque `Notificacao` nao tem `veiculoId`. */
  tipo: "atribuicao" | "sla_estourado" | "os_nova" | "mensagem" | "mencao" | "frota_alerta";
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
  /**
   * Bloco SEPARADO das OS executadas por equipes de fora (retirada/
   * cancelamento) — fica fora de todos os campos acima porque as metricas da
   * operacao ISPhub nao podem embutir trabalho que nao e da equipe.
   */
  retiradas: DashboardRetiradas;
}

/**
 * O dia do tecnico, do ponto de vista DELE — nao do gestor.
 *
 * Distinto de `DashboardMetrics`, que e agregado global e sem recorte de dia.
 * Aqui o corte e o dia CIVIL brasileiro (ver meuDiaService.diaBrasileiro) e o
 * escopo e sempre o proprio tecnico.
 *
 * `concluidas` e o campo que justifica o endpoint existir: o app derivava os
 * contadores da fila ABERTA em memoria, e uma lista de abertas nao sabe de
 * concluida — o tecnico terminava o dia e o numero nao mexia.
 */
export interface MeuDiaResumo {
  /** Abertas hoje que ainda nao sairam do lugar. */
  programadas: number;
  concluidas: number;
  /** Em deslocamento ou em execucao: ja comecaram, nao terminaram. */
  pendentes: number;
  /** Canceladas — cliente ausente, sem acesso, etc. */
  naoRealizadas: number;
  /** 0..100. Concluidas sobre o total do dia; ver meuDiaService.produtividade. */
  produtividade: number;
}

/** Metricas das OS de equipe externa (retirada/cancelamento) — ver DashboardMetrics.retiradas. */
/** A agenda vista pelo gestor: ocupacao da semana, pendencias e quem marcou. */
export interface DashboardAgenda {
  /** Janela, em dias, do ranking `porFuncionario`. */
  dias: number;
  /** Grade de hoje + 6 dias (dia x turno), com bloqueios e ocupacao. */
  ocupacao: VagaTurno[];
  /** Marcadas nos proximos 7 dias que o cliente ainda nao confirmou. */
  semConfirmacaoCliente: number;
  /** Marcadas cuja data o SGP do provedor ainda nao refletiu. */
  pendentesSgp: number;
  porFuncionario: { marcadoPor: string; origem: string; marcadas: number; canceladas: number }[];
}

export interface DashboardRetiradas {
  abertas: number;
  concluidas: number;
  slaEstourado: number;
  porProvedor: { provedorId: string; provedorNome: string; cor: string; abertas: number; concluidas: number }[];
}
