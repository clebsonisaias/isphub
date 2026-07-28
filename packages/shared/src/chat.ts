import type { UserRole } from "./roles.js";

/**
 * Chat interno de operacao — NAO e messenger social, e coordenacao de campo
 * ancorada no trabalho (a conversa mais importante e a de uma OS, nao a DM).
 * PROVEDOR nunca participa (ver chatService.podeParticipar na API).
 */

/** Tipo de conversa — DM 1:1, grupo, thread ancorada numa OS, ou o canal unico de Avisos. */
export enum ConversaTipo {
  DIRETA = "direta",
  GRUPO = "grupo",
  OS = "os",
  AVISOS = "avisos",
}

/** Tipo de mensagem. SISTEMA = mensagem automatica (ex.: "Fulano assumiu a OS"), sem autor humano. */
export enum MensagemTipo {
  TEXTO = "texto",
  FOTO = "foto",
  AUDIO = "audio",
  LOCALIZACAO = "localizacao",
  OS_REF = "os_ref",
  SISTEMA = "sistema",
}

/**
 * Participante de uma conversa com presenca ja resolvida pelo servidor
 * (`online` deriva de `ultimaAtividadeEm` dentro de ~2min — ver middleware de
 * presenca da API). O cliente nunca calcula isso sozinho.
 */
export interface ParticipanteResumo {
  usuarioId: string;
  nome: string;
  role: UserRole;
  online: boolean;
  ultimaAtividadeEm?: string | null;
}

/**
 * Preview leve da ultima mensagem de uma conversa — usado só na LISTA de
 * conversas (GET /chat/conversas), pra nao paginar mensagens so pra montar a
 * pre-visualizacao. `corpo` null quando a mensagem foi apagada (soft delete)
 * ou quando o tipo nao tem corpo textual proprio (ex.: audio sem legenda).
 */
export interface MensagemResumo {
  id: string;
  tipo: MensagemTipo;
  corpo?: string | null;
  autorNome?: string | null;
  apagadoEm?: string | null;
  criadoEm: string;
}

/** Resumo de uma conversa pra lista (GET /chat/conversas). */
export interface ConversaResumo {
  id: string;
  tipo: ConversaTipo;
  /** Titulo explicito (grupo/avisos) — DM e thread de OS derivam o titulo no servidor (nome do outro participante / "OS #sgpOsId"). */
  titulo: string;
  avatarCor?: string | null;
  ordemServicoId?: string | null;
  sgpOsId?: string | null;
  participantes: ParticipanteResumo[];
  ultimaMensagem?: MensagemResumo | null;
  /** Contagem de mensagens com criadoEm > ultimaLeituraEm do participante (marca d'agua — sem linha de "lido" por mensagem). */
  naoLidas: number;
  silenciado: boolean;
  atualizadoEm: string;
}

/** Resposta citada, renderizada acima da bolha. */
export interface MensagemRespondendoA {
  id: string;
  autorNome: string | null;
  /** Preview curto do conteudo original (corpo truncado, ou rotulo do tipo pra foto/audio/localizacao/card de OS). */
  resumo: string;
}

/** Uma reacao (emoji) e quem reagiu — agregada por emoji, nao uma linha por reacao individual. */
export interface MensagemReacao {
  emoji: string;
  usuarioIds: string[];
}

/** Mensagem completa (GET /chat/conversas/:id/mensagens, paginada por cursor). */
export interface Mensagem {
  id: string;
  conversaId: string;
  /** null = mensagem do sistema ("Fulano assumiu a OS"), sem autor humano. */
  autor?: ParticipanteResumo | null;
  tipo: MensagemTipo;
  corpo?: string | null;
  anexoMime?: string | null;
  anexoTamanho?: number | null;
  /** Audio, em segundos. */
  duracaoSeg?: number | null;
  lat?: number | null;
  lng?: number | null;
  /** Card de OS compartilhado (tipo OS_REF). */
  ordemServicoId?: string | null;
  respondendoA?: MensagemRespondendoA | null;
  reacoes: MensagemReacao[];
  editadoEm?: string | null;
  /** SOFT DELETE — contexto operacional e prova; a bolha vira "Mensagem apagada", nada some do banco. */
  apagadoEm?: string | null;
  criadoEm: string;
}

/** Contato minimo pra "Nova conversa" (GET /chat/contatos) — NUNCA email/provedorId/hash. */
export interface ContatoChat {
  id: string;
  nome: string;
  role: UserRole;
  online: boolean;
}
