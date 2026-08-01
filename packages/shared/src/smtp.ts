/** O que a tela do admin ENVIA ao salvar o servidor de e-mail. */
export interface SmtpConfigInput {
  host: string;
  porta: number;
  /** TLS implicito (465) x STARTTLS (587/25). Omitido = deduz pela porta. */
  secure?: boolean;
  usuario?: string | null;
  /**
   * Ausente MANTEM a senha atual. A tela nunca recebe a senha de volta, entao
   * exigi-la a cada save obrigaria a redigitar o segredo so pra corrigir um
   * erro de digitacao no host.
   */
  senha?: string | null;
  remetente?: string | null;
  ativo?: boolean;
}

/** O que a API DEVOLVE — a senha sai mascarada, nunca em claro. */
export interface SmtpConfigPublic {
  configurado: boolean;
  ativo: boolean;
  /**
   * De onde vem a configuracao em uso: "admin" (esta tela) ou "ambiente"
   * (variaveis do servidor). Distinguir importa — sem isso o admin veria
   * "nao configurado" numa instalacao onde o e-mail funciona.
   */
  origem: "admin" | "ambiente" | null;
  host: string | null;
  porta: number | null;
  secure: boolean | null;
  usuario: string | null;
  senhaMascarada: string | null;
  remetente: string | null;
  ultimaVerificacaoEm: string | null;
  ultimaVerificacaoOk: boolean | null;
  ultimaVerificacaoMensagem: string | null;
}
