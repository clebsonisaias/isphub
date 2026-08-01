import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { invalidarCacheSessao, revogarSessoes } from "./sessaoService.js";

/**
 * Sessao longa do navegador — refresh token rotativo.
 *
 * O access token (JWT) e curto e vai em toda chamada; o refresh e longo, fica
 * guardado no cliente e so aparece na rota de renovacao. Separar os dois e o
 * que permite "continuar conectado" sem manter uma credencial de 30 dias
 * circulando em cada request.
 *
 * Rotacao: cada uso QUEIMA o refresh e emite outro. Um refresh vazado so vale
 * ate o dono renovar — e o uso do token queimado denuncia o vazamento (ver
 * `RESULTADO_REUSO`).
 */

/** 30 dias PARADO. Cada renovacao empurra o prazo pra frente. */
const VALIDADE_DIAS = 30;

/**
 * Janela em que o refresh recem-rotacionado ainda responde, devolvendo o
 * sucessor em vez de acusar reuso.
 *
 * Existe por causa de abas paralelas: duas abas com o mesmo refresh renovando
 * ao mesmo tempo: a primeira queima o token, a segunda chega com um token ja
 * revogado — indistinguivel de roubo. Sem esta janela, abrir duas abas
 * deslogaria a pessoa de todo lugar.
 *
 * 30s cobre o descompasso real entre abas sem virar brecha: passado esse
 * tempo, apresentar um token queimado volta a ser tratado como vazamento.
 */
const GRACA_ROTACAO_MS = 30_000;

export type ResultadoRefresh =
  | { tipo: "ok"; usuarioId: string; refreshToken: string }
  /** Token desconhecido, expirado, ou de usuario inativo — so recusa. */
  | { tipo: "invalido" }
  /** Token queimado fora da janela de graca: trata como vazamento. */
  | { tipo: "reuso"; usuarioId: string };

function hashDe(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function novaValidade(): Date {
  return new Date(Date.now() + VALIDADE_DIAS * 24 * 60 * 60 * 1000);
}

export interface ContextoSessao {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Cria uma sessao nova (login). Devolve o token CRU — e a unica vez que ele
 * existe fora do cliente; o banco guarda so o hash.
 */
export async function emitirRefresh(usuarioId: string, ctx: ContextoSessao = {}): Promise<string> {
  const token = randomBytes(48).toString("base64url");
  await prisma.sessaoRefresh.create({
    data: {
      usuarioId,
      tokenHash: hashDe(token),
      expiraEm: novaValidade(),
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
      ip: ctx.ip?.slice(0, 64) ?? null,
    },
  });
  return token;
}

/**
 * Troca um refresh por outro.
 *
 * A rotacao roda numa transacao com `updateMany ... where revogadoEm: null`:
 * duas abas simultaneas disputam a MESMA linha e so uma consegue revogar. A
 * perdedora cai na janela de graca e recebe o sucessor que a vencedora criou.
 */
export async function rotacionarRefresh(
  token: string,
  ctx: ContextoSessao = {},
  tentativa = 0,
): Promise<ResultadoRefresh> {
  /*
   * Guarda de recursao. Perder a corrida devolve o fluxo pra ca uma vez, e a
   * releitura tem que mostrar o token ja revogado. Se por algum motivo nao
   * mostrar (lag de replica, isolamento inesperado), recusar e MUITO melhor do
   * que recursao infinita derrubando o processo.
   */
  if (tentativa > 1) return { tipo: "invalido" };

  const tokenHash = hashDe(token);
  const sessao = await prisma.sessaoRefresh.findUnique({
    where: { tokenHash },
    include: { usuario: { select: { ativo: true } } },
  });

  if (!sessao) return { tipo: "invalido" };
  if (!sessao.usuario.ativo) return { tipo: "invalido" };
  if (sessao.expiraEm.getTime() <= Date.now()) return { tipo: "invalido" };

  if (sessao.revogadoEm) {
    // Ja foi usado. Dentro da janela e a outra aba; fora dela e vazamento.
    const dentroDaGraca = Date.now() - sessao.revogadoEm.getTime() <= GRACA_ROTACAO_MS;
    if (!dentroDaGraca) return { tipo: "reuso", usuarioId: sessao.usuarioId };

    /*
     * Emite uma sessao IRMA em vez de devolver o token do sucessor: o banco
     * guarda so o hash, entao o token do sucessor nao existe mais deste lado —
     * nao ha o que devolver. Cada aba fica com a sua sessao, o que e correto
     * (sao dois clientes) e mantem a regra de nunca persistir token cru.
     */
    const irmao = await emitirRefresh(sessao.usuarioId, {
      userAgent: ctx.userAgent ?? sessao.userAgent,
      ip: ctx.ip ?? sessao.ip,
    });
    return { tipo: "ok", usuarioId: sessao.usuarioId, refreshToken: irmao };
  }

  const agora = new Date();
  const novoToken = randomBytes(48).toString("base64url");

  const rotacionou = await prisma.$transaction(async (tx) => {
    // Guarda de concorrencia: so quem encontrar a linha AINDA nao revogada
    // segue. A aba perdedora recebe count 0 e sai sem criar sessao duplicada.
    const { count } = await tx.sessaoRefresh.updateMany({
      where: { id: sessao.id, revogadoEm: null },
      data: { revogadoEm: agora, usadoEm: agora },
    });
    if (count === 0) return false;

    await tx.sessaoRefresh.create({
      data: {
        usuarioId: sessao.usuarioId,
        tokenHash: hashDe(novoToken),
        expiraEm: novaValidade(),
        userAgent: ctx.userAgent?.slice(0, 300) ?? sessao.userAgent,
        ip: ctx.ip?.slice(0, 64) ?? sessao.ip,
      },
    });
    return true;
  });

  if (!rotacionou) {
    // Perdeu a corrida pra outra aba: repete a leitura, que agora cai no
    // caminho da janela de graca acima.
    return rotacionarRefresh(token, ctx, tentativa + 1);
  }

  return { tipo: "ok", usuarioId: sessao.usuarioId, refreshToken: novoToken };
}

/** Logout desta sessao. Idempotente: token desconhecido nao e erro. */
export async function revogarRefresh(token: string): Promise<void> {
  await prisma.sessaoRefresh.updateMany({
    where: { tokenHash: hashDe(token), revogadoEm: null },
    data: { revogadoEm: new Date() },
  });
}

/**
 * "Sair de todos os dispositivos": mata as sessoes longas E os access tokens
 * ja emitidos. So revogar o refresh deixaria o JWT atual valendo ate 8h.
 */
export async function revogarTudoDoUsuario(usuarioId: string): Promise<void> {
  await prisma.sessaoRefresh.updateMany({
    where: { usuarioId, revogadoEm: null },
    data: { revogadoEm: new Date() },
  });
  await revogarSessoes(usuarioId);
  invalidarCacheSessao(usuarioId);
}
