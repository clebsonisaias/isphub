import type { SmtpConfigInput, SmtpConfigPublic } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { decrypt, encrypt, maskToken } from "../lib/crypto.js";
import { HttpError } from "../middleware/errorHandler.js";
import { enviarEmailComErro, obterConfigSmtp, type ConfigSmtp } from "./emailService.js";

/**
 * Configuracao do servidor de e-mail pela tela do admin.
 *
 * Mesmo desenho do canaisWhatsappService: o blob inteiro e re-cifrado a cada
 * save (nunca merge parcial em cima do cifrado) e a senha **nunca** volta pro
 * cliente — sai mascarada.
 */

const ESCOPO = "global";

interface SmtpConfigArmazenado {
  host: string;
  porta: number;
  secure: boolean;
  usuario: string | null;
  senha: string | null;
  remetente: string | null;
}

async function lerArmazenado(): Promise<SmtpConfigArmazenado | null> {
  const row = await prisma.smtpConfig.findUnique({ where: { escopo: ESCOPO } });
  if (!row) return null;
  try {
    return JSON.parse(decrypt(row.configCifrado)) as SmtpConfigArmazenado;
  } catch {
    return null;
  }
}

/**
 * Salva a configuracao.
 *
 * `senha` ausente MANTEM a senha atual — a tela nunca recebe a senha de volta,
 * entao exigi-la a cada save obrigaria a redigitar o segredo pra corrigir um
 * erro de digitacao no host. Se nao havia senha antes e nenhuma veio, fica sem.
 */
export async function salvarConfig(input: SmtpConfigInput): Promise<SmtpConfigPublic> {
  const anterior = await lerArmazenado();
  const senha = input.senha ?? anterior?.senha ?? null;

  const dados: SmtpConfigArmazenado = {
    host: input.host.trim(),
    porta: input.porta,
    // Sem escolha explicita, deduz pela porta: 465 e TLS implicito, o resto
    // sobe por STARTTLS.
    secure: input.secure ?? input.porta === 465,
    usuario: input.usuario?.trim() || null,
    senha,
    remetente: input.remetente?.trim() || null,
  };

  const configCifrado = encrypt(JSON.stringify(dados));
  const row = await prisma.smtpConfig.upsert({
    where: { escopo: ESCOPO },
    create: { escopo: ESCOPO, configCifrado, ativo: input.ativo ?? true },
    update: { configCifrado, ativo: input.ativo ?? true },
  });

  return toPublic(row, dados);
}

export async function obterConfigPublic(): Promise<SmtpConfigPublic> {
  const row = await prisma.smtpConfig.findUnique({ where: { escopo: ESCOPO } });
  const dados = await lerArmazenado();

  if (!row || !dados) {
    /*
     * Ainda nao configurado pela tela. Informa se o AMBIENTE cobre — senao o
     * admin veria "nao configurado" numa instalacao onde o e-mail funciona, e
     * poderia sobrescrever uma configuracao boa achando que nao havia nenhuma.
     */
    const doAmbiente = await obterConfigSmtp();
    return {
      configurado: false,
      ativo: false,
      origem: doAmbiente?.origem === "ambiente" ? "ambiente" : null,
      host: doAmbiente?.origem === "ambiente" ? doAmbiente.host : null,
      porta: doAmbiente?.origem === "ambiente" ? doAmbiente.porta : null,
      secure: doAmbiente?.origem === "ambiente" ? doAmbiente.secure : null,
      usuario: doAmbiente?.origem === "ambiente" ? (doAmbiente.usuario ?? null) : null,
      senhaMascarada: null,
      remetente: doAmbiente?.origem === "ambiente" ? (doAmbiente.remetente ?? null) : null,
      ultimaVerificacaoEm: null,
      ultimaVerificacaoOk: null,
      ultimaVerificacaoMensagem: null,
    };
  }

  return toPublic(row, dados);
}

function toPublic(
  row: {
    ativo: boolean;
    ultimaVerificacaoEm: Date | null;
    ultimaVerificacaoOk: boolean | null;
    ultimaVerificacaoMensagem: string | null;
  },
  dados: SmtpConfigArmazenado,
): SmtpConfigPublic {
  return {
    configurado: true,
    ativo: row.ativo,
    origem: "admin",
    host: dados.host,
    porta: dados.porta,
    secure: dados.secure,
    usuario: dados.usuario,
    // Mascarada, nunca em claro — mesma regra dos tokens de canal.
    senhaMascarada: dados.senha ? maskToken(dados.senha) : null,
    remetente: dados.remetente,
    ultimaVerificacaoEm: row.ultimaVerificacaoEm?.toISOString() ?? null,
    ultimaVerificacaoOk: row.ultimaVerificacaoOk,
    ultimaVerificacaoMensagem: row.ultimaVerificacaoMensagem,
  };
}

/**
 * Manda um e-mail de teste e grava o resultado.
 *
 * E o unico jeito de saber que a configuracao funciona ANTES de alguem
 * depender dela pra recuperar a senha — SMTP errado so se manifestaria no pior
 * momento possivel, com a pessoa trancada do lado de fora.
 */
export async function enviarTeste(destinatario: string): Promise<{ ok: boolean; mensagem: string }> {
  const config = await obterConfigSmtp();
  if (!config) throw new HttpError(400, "Configure o servidor de e-mail antes de testar");

  let ok = true;
  let mensagem = "E-mail de teste enviado.";
  try {
    await enviarEmailComErro(
      {
        para: destinatario,
        assunto: "ISPhub — teste de configuracao de e-mail",
        texto: "Deu certo. Se voce recebeu esta mensagem, o servidor de e-mail do ISPhub esta funcionando.",
        html: "<p>Deu certo. Se voce recebeu esta mensagem, o servidor de e-mail do ISPhub esta funcionando.</p>",
      },
      config,
    );
  } catch (err) {
    ok = false;
    // A mensagem do SMTP e o que aponta o erro real (auth, DNS, porta, TLS).
    mensagem = err instanceof Error ? err.message : String(err);
  }

  // So grava quando a config veio da TELA: nao ha linha pra atualizar quando o
  // e-mail esta vindo do ambiente.
  if (config.origem === "admin") {
    await prisma.smtpConfig.update({
      where: { escopo: ESCOPO },
      data: {
        ultimaVerificacaoEm: new Date(),
        ultimaVerificacaoOk: ok,
        ultimaVerificacaoMensagem: mensagem.slice(0, 300),
      },
    });
  }

  return { ok, mensagem };
}

/** Desliga o envio sem apagar a configuracao (volta pro ambiente, se houver). */
export async function definirAtivo(ativo: boolean): Promise<SmtpConfigPublic> {
  await prisma.smtpConfig.update({ where: { escopo: ESCOPO }, data: { ativo } });
  return obterConfigPublic();
}

export type { ConfigSmtp };
