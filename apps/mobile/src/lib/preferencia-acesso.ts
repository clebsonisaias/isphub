/**
 * O que o tecnico escolheu deixar salvo NESTE aparelho.
 *
 * "Salvar os dados" sao tres coisas diferentes — lembrar o e-mail, manter a
 * sessao viva e entrar sem digitar nada — e e justamente misturar as tres que
 * deixa essas telas confusas. Vira UMA escolha com tres saidas.
 *
 * Arquivo sem imports de proposito: e a unica peca aqui cujo erro tem
 * consequencia de privacidade, entao ela precisa ser testavel sem mockar
 * nativo. Mesmo motivo de `evidencias/limites.ts`.
 */
export type PreferenciaAcesso = "biometria" | "email" | "nada";

export interface EfeitoAcesso {
  /** Grava o par (access, refresh) no aparelho pra sobreviver o app fechar. */
  guardaSessao: boolean;
  /** Grava o e-mail pra pre-preencher o login. */
  guardaEmail: boolean;
  /** Pede Face ID/digital na abertura. */
  pedeBiometria: boolean;
}

/**
 * "Nao salvar nada" tem que ser LITERAL, nao enfeite: sem refresh gravado, sem
 * e-mail gravado, sessao so em memoria — fechou o app, saiu. O proprio codigo
 * de logout ja registra que estes aparelhos sao compartilhados pela equipe,
 * entao um "nao salvar" que salva em silencio seria mentira com consequencia.
 */
export function efeitoDe(p: PreferenciaAcesso): EfeitoAcesso {
  if (p === "biometria") return { guardaSessao: true, guardaEmail: true, pedeBiometria: true };
  if (p === "email") return { guardaSessao: false, guardaEmail: true, pedeBiometria: false };
  return { guardaSessao: false, guardaEmail: false, pedeBiometria: false };
}

/** Type guard pro que volta do storage — string qualquer nao vira preferencia. */
export function ehPreferencia(v: string | null | undefined): v is PreferenciaAcesso {
  return v === "biometria" || v === "email" || v === "nada";
}
