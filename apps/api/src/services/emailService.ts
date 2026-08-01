import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

/**
 * Envio de e-mail transacional.
 *
 * Duas regras que valem pra tudo aqui:
 *
 * 1. **Degrada, nunca derruba.** Sem SMTP configurado (dev, teste, e2e) o
 *    e-mail vira log e a vida segue. Uma API que nao sobe porque nao ha
 *    servidor de e-mail seria pior que o recurso nao existir.
 *
 * 2. **Falha de envio nao vira erro da rota.** A rota de recuperacao de senha
 *    responde a mesma coisa com e-mail existente ou nao — se um SMTP fora do ar
 *    virasse 500, essa resposta uniforme quebraria e a tela viraria um oraculo
 *    de quem tem conta no sistema.
 */

export interface Email {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

let transporterCache: Transporter | null = null;

export function smtpConfigurado(): boolean {
  return Boolean(env.SMTP_HOST);
}

function obterTransporter(): Transporter | null {
  if (!smtpConfigurado()) return null;
  if (transporterCache) return transporterCache;

  const porta = env.SMTP_PORT ?? 587;
  transporterCache = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: porta,
    // 465 e TLS implicito; 587/25 sobem por STARTTLS. Errar isso e a causa
    // mais comum de "conecta e trava" em SMTP.
    secure: porta === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporterCache;
}

/**
 * Devolve `true` se entregou ao servidor de e-mail. Quem chama NAO deve mudar
 * a resposta HTTP com base nisso — o retorno serve pra log e teste.
 */
export async function enviarEmail(email: Email): Promise<boolean> {
  const transporter = obterTransporter();

  if (!transporter) {
    /*
     * Sem SMTP: o corpo NAO vai pro log — e-mail de recuperacao carrega um
     * link que vale por uma troca de senha. Quem estiver em dev tem o link
     * logado pelo proprio chamador, que sabe o que e sensivel ali.
     */
    console.warn(`[email] SMTP nao configurado — "${email.assunto}" nao foi enviado para ${email.para}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: env.SMTP_FROM ?? env.SMTP_USER,
      to: email.para,
      subject: email.assunto,
      text: email.texto,
      html: email.html,
    });
    return true;
  } catch (err) {
    // Log sem o corpo: a mensagem de erro do SMTP pode ecoar o envelope.
    console.error(`[email] falha ao enviar "${email.assunto}": ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Só para teste: descarta o transporter memoizado entre casos. */
export function resetarTransporterParaTeste(): void {
  transporterCache = null;
}
