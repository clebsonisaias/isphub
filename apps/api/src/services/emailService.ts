import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { decrypt } from "../lib/crypto.js";

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

/** Config efetiva de envio, venha do admin ou do ambiente. */
export interface ConfigSmtp {
  host: string;
  porta: number;
  /** true = TLS implicito (465); false = STARTTLS (587/25). */
  secure: boolean;
  usuario?: string | null;
  senha?: string | null;
  remetente?: string | null;
  /** De onde veio — so pra exibir/diagnosticar, nunca pra decidir envio. */
  origem: "admin" | "ambiente";
}

let transporterCache: { chave: string; transporter: Transporter } | null = null;

/**
 * Resolve a configuracao efetiva: **o que o admin salvou vence**, e as
 * variaveis de ambiente ficam como reserva.
 *
 * Essa ordem e o que permite trocar a senha do SMTP pela tela sem redeploy,
 * sem invalidar quem ja configurou por ambiente (a instalacao atual, que
 * continua funcionando sem tocar em nada).
 */
export async function obterConfigSmtp(): Promise<ConfigSmtp | null> {
  try {
    const row = await prisma.smtpConfig.findUnique({ where: { escopo: "global" } });
    if (row?.ativo) {
      const dados = JSON.parse(decrypt(row.configCifrado)) as Record<string, unknown>;
      const host = typeof dados.host === "string" ? dados.host : "";
      if (host) {
        const porta = Number(dados.porta) || 587;
        return {
          host,
          porta,
          secure: typeof dados.secure === "boolean" ? dados.secure : porta === 465,
          usuario: typeof dados.usuario === "string" ? dados.usuario : null,
          senha: typeof dados.senha === "string" ? dados.senha : null,
          remetente: typeof dados.remetente === "string" ? dados.remetente : null,
          origem: "admin",
        };
      }
    }
  } catch {
    // Banco fora do ar ou blob corrompido: cai pro ambiente em vez de deixar
    // a recuperacao de senha sem nenhum caminho.
  }

  if (!env.SMTP_HOST) return null;
  const porta = env.SMTP_PORT ?? 587;
  return {
    host: env.SMTP_HOST,
    porta,
    secure: porta === 465,
    usuario: env.SMTP_USER ?? null,
    senha: env.SMTP_PASS ?? null,
    remetente: env.SMTP_FROM ?? null,
    origem: "ambiente",
  };
}

export async function smtpConfigurado(): Promise<boolean> {
  return (await obterConfigSmtp()) !== null;
}

/**
 * Transporter memoizado por CONTEUDO da config: trocar host/porta/senha pela
 * tela invalida o cache sozinho. Memoizar por instancia (como era) faria a
 * configuracao nova so valer no proximo restart da API.
 */
export function transporterDe(config: ConfigSmtp): Transporter {
  const chave = JSON.stringify([config.host, config.porta, config.secure, config.usuario, config.senha]);
  if (transporterCache?.chave === chave) return transporterCache.transporter;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.porta,
    // 465 e TLS implicito; 587/25 sobem por STARTTLS. Errar isso e a causa
    // mais comum de "conecta e trava" em SMTP.
    secure: config.secure,
    auth: config.usuario ? { user: config.usuario, pass: config.senha ?? undefined } : undefined,
  });
  transporterCache = { chave, transporter };
  return transporter;
}

/**
 * Devolve `true` se entregou ao servidor de e-mail. Quem chama NAO deve mudar
 * a resposta HTTP com base nisso — o retorno serve pra log e teste.
 */
export async function enviarEmail(email: Email, configForcada?: ConfigSmtp): Promise<boolean> {
  // `configForcada` existe pro "enviar e-mail de teste" do admin: ele precisa
  // testar o que a pessoa ACABOU de digitar, antes de salvar.
  const config = configForcada ?? (await obterConfigSmtp());

  if (!config) {
    /*
     * Sem SMTP: o corpo NAO vai pro log — e-mail de recuperacao carrega um
     * link que vale por uma troca de senha. Quem estiver em dev tem o link
     * logado pelo proprio chamador, que sabe o que e sensivel ali.
     */
    console.warn(`[email] SMTP nao configurado — "${email.assunto}" nao foi enviado para ${email.para}`);
    return false;
  }

  try {
    await transporterDe(config).sendMail({
      from: config.remetente ?? config.usuario ?? undefined,
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

/**
 * Igual ao `enviarEmail`, mas PROPAGA o motivo da falha.
 *
 * O envio normal engole o erro de proposito (a rota de recuperacao tem que
 * responder identico com SMTP no ar ou fora). No teste do admin e o oposto:
 * "nao funcionou" sem dizer por que nao ajuda ninguem a consertar.
 */
export async function enviarEmailComErro(email: Email, config: ConfigSmtp): Promise<void> {
  await transporterDe(config).sendMail({
    from: config.remetente ?? config.usuario ?? undefined,
    to: email.para,
    subject: email.assunto,
    text: email.texto,
    html: email.html,
  });
}

/** Só para teste: descarta o transporter memoizado entre casos. */
export function resetarTransporterParaTeste(): void {
  transporterCache = null;
}
