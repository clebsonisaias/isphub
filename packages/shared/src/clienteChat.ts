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

/** Teto de mídia recebida do WhatsApp — maior que o do chat interno (400KB) pois nao controlamos a compressao do lado do cliente. */
export const LIMITE_MIDIA_CLIENTE_BYTES = 5 * 1024 * 1024;

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
  criadoEm: string;
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
}

export interface EvolutionWhatsappConfigInput {
  tipo: "evolution";
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

export type CanalWhatsappConfigInput = MetaWhatsappConfigInput | EvolutionWhatsappConfigInput;
