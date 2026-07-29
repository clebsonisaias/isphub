/**
 * Chat com clientes via WhatsApp — caixa de entrada omnichannel SO de staff
 * (ADMIN/GESTOR/TECNICO; PROVEDOR nunca participa, mesma fronteira do chat
 * interno). Cliente nao tem login nem Usuario — so telefone. Separado de
 * propósito do chat interno (packages/shared/src/chat.ts) — ver plano da
 * feature: ConversaParticipante.usuarioId e FK obrigatoria pra Usuario, um
 * contato externo nao entra ali sem forcar o modelo.
 */

/** Qual integracao WhatsApp originou/atende a conversa — atributo da conversa, nao uma tela de navegacao. */
export enum CanalWhatsapp {
  META = "meta",
  EVOLUTION = "evolution",
}

export const CANAL_WHATSAPP_LABEL: Record<CanalWhatsapp, string> = {
  [CanalWhatsapp.META]: "WhatsApp Oficial",
  [CanalWhatsapp.EVOLUTION]: "WhatsApp (Evolution)",
};

export enum MensagemClienteDirecao {
  ENTRADA = "entrada",
  SAIDA = "saida",
}

export enum MensagemClienteTipo {
  TEXTO = "texto",
  IMAGEM = "imagem",
  AUDIO = "audio",
  DOCUMENTO = "documento",
  LOCALIZACAO = "localizacao",
  SISTEMA = "sistema",
}

/** Quem deu o primeiro passo: `entrada` = cliente escreveu; `saida` = staff disparou template. */
export enum OrigemConversaCliente {
  ENTRADA = "entrada",
  SAIDA = "saida",
}

/** Teto de mídia recebida do WhatsApp — maior que o do chat interno (400KB) pois nao controlamos a compressao do lado do cliente. */
export const LIMITE_MIDIA_CLIENTE_BYTES = 5 * 1024 * 1024;

/**
 * Filtro de listagem. `todas` e privilegio de ADMIN/GESTOR — o servidor NUNCA
 * deixa o filtro do cliente alargar o escopo, so estreitar (ver
 * escopoConversaClienteWhere). Para TECNICO, `todas` equivale a `minhas`.
 */
export const FILTROS_CONVERSA_CLIENTE = ["fila", "minhas", "todas"] as const;
export type FiltroConversaCliente = (typeof FILTROS_CONVERSA_CLIENTE)[number];

/**
 * Status derivado no SERVIDOR a partir de agenteId/arquivada — o cliente
 * nunca infere isso sozinho (mesmo principio do `online` do chat interno).
 */
export type StatusConversaCliente = "fila" | "em_atendimento" | "arquivada";

export interface ConversaClienteResumo {
  id: string;
  telefone: string;
  nomeContato?: string | null;
  canal: CanalWhatsapp;
  status: StatusConversaCliente;
  agenteId?: string | null;
  agenteNome?: string | null;
  origem: OrigemConversaCliente;
  /** Quem abriu por template. null = entrante. Chave de visibilidade do TECNICO. */
  iniciadaPorId?: string | null;
  iniciadaPorNome?: string | null;
  /**
   * Se a janela de 24h do WhatsApp esta aberta (houve mensagem DO CLIENTE nas
   * ultimas 24h). Fora dela a Meta so aceita template — sem este campo o
   * atendente digita, envia, e a mensagem vira uma bolha com falhaEnvio sem
   * explicacao. Derivado no servidor a partir do historico, nao ha tabela.
   */
  dentroJanela24h: boolean;
  ultimaMensagem?: {
    corpo?: string | null;
    tipo: MensagemClienteTipo;
    direcao: MensagemClienteDirecao;
    criadoEm: string;
  } | null;
  naoLidas: number;
  atualizadoEm: string;
}

export interface MensagemClienteDTO {
  id: string;
  conversaId: string;
  canal: CanalWhatsapp;
  direcao: MensagemClienteDirecao;
  autorId?: string | null;
  autorNome?: string | null;
  tipo: MensagemClienteTipo;
  corpo?: string | null;
  anexoMime?: string | null;
  anexoTamanho?: number | null;
  duracaoSeg?: number | null;
  lat?: number | null;
  lng?: number | null;
  falhaEnvio?: string | null;
  /** Template HSM que originou esta mensagem; `corpo` ja vem renderizado. */
  templateNome?: string | null;
  criadoEm: string;
}

/**
 * Template HSM aprovado, lido AO VIVO da Graph API da Meta (mesmo desenho do
 * Maxxi: sem tabela local, cache de 5 min). Um template pode ser rejeitado pela
 * Meta a qualquer momento — copia local envelheceria em silencio.
 */
export interface TemplateWhatsappDTO {
  nome: string;
  /** Codigo do idioma da definicao aprovada (ex.: "pt_BR"). NAO assumir pt_BR. */
  idioma: string;
  categoria: string;
  /** Texto do corpo com os placeholders `{{n}}` ainda no lugar — pra preview. */
  corpo: string;
  /** Texto do header, quando ele e do tipo TEXT. */
  header?: string | null;
  /**
   * Indices das variaveis exigidas, em ordem (ex.: [1,2,3]). Derivado dos
   * placeholders `{{n}}` de header+corpo — e o que define quantos parametros
   * o disparo precisa mandar.
   */
  variaveis: number[];
}

export interface IniciarConversaClienteInput {
  telefone: string;
  nomeContato?: string;
  canal: CanalWhatsapp;
  templateNome: string;
  /** Valor por indice de variavel: { "1": "Joao", "2": "10/08" }. */
  vars?: Record<string, string>;
}

/** Config mascarada de um canal — nunca os segredos reais, so o suficiente pra UI mostrar "configurado" + testar. */
export interface CanalWhatsappConfigPublic {
  tipo: CanalWhatsapp;
  configurado: boolean;
  ativo: boolean;
  /** Campos nao-secretos + versoes mascaradas dos secretos (ex.: "3a4e****aad0"), chave por nome de campo. */
  campos: Record<string, string>;
  ultimaVerificacaoEm?: string | null;
  ultimaVerificacaoOk?: boolean | null;
  ultimaVerificacaoMensagem?: string | null;
}

export interface MetaWhatsappConfigInput {
  tipo: "meta";
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  /**
   * ID da conta WhatsApp Business (WABA). Necessario SO pra listar templates
   * (`GET /{wabaId}/message_templates`) — o envio de texto usa phoneNumberId e
   * funciona sem ele. Nao e segredo: nao entra em CAMPOS_SECRETOS, nao e
   * mascarado. Opcional pra nao invalidar canal ja configurado.
   */
  wabaId?: string;
}

export interface EvolutionWhatsappConfigInput {
  tipo: "evolution";
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

export type CanalWhatsappConfigInput = MetaWhatsappConfigInput | EvolutionWhatsappConfigInput;
