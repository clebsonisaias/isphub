import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "./authService.js";
import { enviarEmail, smtpConfigurado } from "./emailService.js";
import { revogarTudoDoUsuario } from "./refreshService.js";

/**
 * Recuperacao de senha por link de uso unico.
 *
 * Duas propriedades sustentam a seguranca disso, e as duas sao faceis de perder
 * numa refatoracao distraida:
 *
 * 1. **A resposta nao revela se o e-mail existe.** `solicitar()` devolve void
 *    sempre, aconteca o que acontecer. Se ela sinalizasse "usuario nao
 *    encontrado", a tela de recuperacao viraria um oraculo de quem tem conta.
 *
 * 2. **O banco guarda so o hash do token.** Quem le o banco nao consegue forjar
 *    o link que chegou no e-mail da pessoa.
 */

/** Curto de proposito: o link e uma credencial que troca senha sem saber a atual. */
const VALIDADE_MINUTOS = 60;

function hashDe(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Cria o token e dispara o e-mail. Silenciosa por contrato — ver (1) acima.
 *
 * Nao lanca nem quando o SMTP falha: a rota tem que responder identico nos dois
 * casos, senao o tempo/erro da resposta denuncia quem tem conta.
 */
export async function solicitarRecuperacao(email: string): Promise<void> {
  const usuario = await prisma.usuario.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, nome: true, email: true, ativo: true },
  });

  // Usuario inexistente ou desativado: sai sem sinal nenhum pra fora.
  if (!usuario || !usuario.ativo) return;

  /*
   * Invalida pedidos anteriores ainda pendentes. Sem isso, cada clique em
   * "esqueci minha senha" deixaria mais um link vivo por 1h — varias chaves da
   * mesma porta espalhadas na caixa de entrada.
   */
  await prisma.tokenRecuperacaoSenha.updateMany({
    where: { usuarioId: usuario.id, usadoEm: null },
    data: { usadoEm: new Date() },
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.tokenRecuperacaoSenha.create({
    data: {
      usuarioId: usuario.id,
      tokenHash: hashDe(token),
      expiraEm: new Date(Date.now() + VALIDADE_MINUTOS * 60 * 1000),
    },
  });

  // WEB_ORIGIN e uma LISTA (painel, PWA do tecnico...): o link e do painel, a primeira.
  const painel = env.WEB_ORIGIN.split(",")[0]!.trim().replace(/\/$/, "");
  const link = `${painel}/redefinir-senha?token=${encodeURIComponent(token)}`;

  if (!(await smtpConfigurado())) {
    // Sem SMTP (dev/e2e, ou producao ainda sem e-mail configurado) o link vai
    // pro log da API — so quem administra o servidor o le.
    console.warn(`[recuperacao] SMTP ausente — link de ${usuario.email}: ${link}`);
    return;
  }

  await enviarEmail({
    para: usuario.email,
    assunto: "Redefinir sua senha do ISPhub",
    texto: [
      `Ola, ${usuario.nome}.`,
      "",
      "Recebemos um pedido para redefinir a senha da sua conta no ISPhub.",
      `Abra o link abaixo para escolher uma nova senha (vale por ${VALIDADE_MINUTOS} minutos):`,
      "",
      link,
      "",
      "Se nao foi voce que pediu, ignore este e-mail: sua senha continua a mesma.",
    ].join("\n"),
    html: `
      <p>Ola, ${escaparHtml(usuario.nome)}.</p>
      <p>Recebemos um pedido para redefinir a senha da sua conta no ISPhub.</p>
      <p><a href="${link}">Escolher uma nova senha</a> — o link vale por ${VALIDADE_MINUTOS} minutos.</p>
      <p>Se nao foi voce que pediu, ignore este e-mail: sua senha continua a mesma.</p>
    `.trim(),
  });
}

export type ResultadoRedefinicao = { tipo: "ok" } | { tipo: "invalido" };

/**
 * Consome o token e troca a senha.
 *
 * Derruba TODAS as sessoes ao final: quem redefine senha ou esqueceu a antiga,
 * ou desconfia que alguem a tem. Nos dois casos, deixar sessoes antigas vivas
 * anularia o proposito da troca.
 */
export async function redefinirSenha(token: string, novaSenha: string): Promise<ResultadoRedefinicao> {
  const registro = await prisma.tokenRecuperacaoSenha.findUnique({
    where: { tokenHash: hashDe(token) },
    include: { usuario: { select: { id: true, ativo: true } } },
  });

  if (!registro) return { tipo: "invalido" };
  if (registro.usadoEm) return { tipo: "invalido" };
  if (registro.expiraEm.getTime() <= Date.now()) return { tipo: "invalido" };
  if (!registro.usuario.ativo) return { tipo: "invalido" };

  const senhaHash = await hashPassword(novaSenha);

  /*
   * Marcar como usado e trocar a senha na MESMA transacao, com
   * `updateMany ... usadoEm: null` como guarda: dois cliques simultaneos no
   * mesmo link disputam a linha e so um vence. Sem isso, duas requisicoes
   * paralelas passariam as duas pela verificacao acima.
   */
  const consumiu = await prisma.$transaction(async (tx) => {
    const { count } = await tx.tokenRecuperacaoSenha.updateMany({
      where: { id: registro.id, usadoEm: null },
      data: { usadoEm: new Date() },
    });
    if (count === 0) return false;

    await tx.usuario.update({ where: { id: registro.usuario.id }, data: { senhaHash } });
    return true;
  });

  if (!consumiu) return { tipo: "invalido" };

  await revogarTudoDoUsuario(registro.usuario.id);
  return { tipo: "ok" };
}

/** Escapa o nome antes de interpolar no HTML do e-mail (o nome vem do cadastro). */
function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
