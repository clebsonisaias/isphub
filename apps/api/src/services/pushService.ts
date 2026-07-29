import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import type { PushPlataforma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Push (notificacao no aparelho) via Expo Push Service.
 *
 * Irmao do realtimeHub: o SSE so alcanca quem esta com o app ABERTO — e o
 * tecnico em campo esta dirigindo, de luva, com o celular no bolso. Push e o
 * unico caminho que chega com o app fechado.
 *
 * REGRA DE OURO, igual a do SSE: isto e BEST-EFFORT e roda DEPOIS da escrita.
 * Nenhuma falha aqui pode derrubar o envio de uma mensagem ou a atribuicao de
 * uma OS — o trabalho tem que acontecer mesmo que o aviso nao saia.
 */

const expo = new Expo();

/** O que o app recebe em `data` e usa pra abrir a tela certa no toque. */
export type PushDados =
  | { tela: "chat"; conversaId: string }
  | { tela: "chat-clientes"; conversaId: string }
  | { tela: "os"; osId: string };

export interface PushConteudo {
  titulo: string;
  corpo: string;
  dados: PushDados;
  /** Some no icone do app (iOS/Android). Omitir deixa o numero anterior. */
  badge?: number;
}

/**
 * Registra (ou re-registra) o aparelho para o usuario logado.
 *
 * O upsert e por TOKEN porque o token identifica o aparelho, nao a pessoa: se
 * outro tecnico logar no mesmo celular, o registro TROCA de dono. Sem isso o
 * aparelho ficaria com dois donos e o tecnico anterior continuaria recebendo as
 * conversas do novo — vazamento real numa equipe que compartilha aparelho.
 */
export async function registrarToken(usuarioId: string, token: string, plataforma: PushPlataforma) {
  if (!Expo.isExpoPushToken(token)) {
    throw new Error("Token de push invalido");
  }
  await prisma.pushToken.upsert({
    where: { token },
    create: { token, usuarioId, plataforma },
    update: { usuarioId, plataforma },
  });
}

/**
 * Desregistra um aparelho. Chamado no logout — sem isto, quem sai da conta
 * continuaria recebendo push das conversas no celular.
 */
export async function removerToken(token: string) {
  await prisma.pushToken.deleteMany({ where: { token } });
}

/** Descarta tokens que o Expo declarou mortos (app desinstalado, token rotacionado). */
async function limparTokensMortos(tokens: string[]) {
  if (tokens.length === 0) return;
  await prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
  console.warn(`[push] ${tokens.length} token(s) removido(s): aparelho nao registrado`);
}

/**
 * Envia push para um conjunto de usuarios. NUNCA lanca — qualquer falha e
 * logada e engolida (ver a regra de ouro no topo do arquivo).
 *
 * Dispara sem await no chamador (fire-and-forget); a resolucao so serve pro
 * teste conseguir esperar.
 */
export async function enviarPush(usuarioIds: string[], conteudo: PushConteudo): Promise<void> {
  try {
    const alvos = [...new Set(usuarioIds.filter(Boolean))];
    if (alvos.length === 0) return;

    const registros = await prisma.pushToken.findMany({
      where: { usuarioId: { in: alvos } },
      select: { token: true },
    });
    // Um usuario pode ter varios aparelhos; um aparelho, um token.
    const tokens = registros.map((r) => r.token).filter((t) => Expo.isExpoPushToken(t));
    if (tokens.length === 0) return;

    const mensagens: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: conteudo.titulo,
      body: conteudo.corpo,
      data: conteudo.dados,
      sound: "default",
      ...(conteudo.badge !== undefined ? { badge: conteudo.badge } : {}),
      // Canal do Android criado no app (ver lib/push.ts do mobile). Sem ele o
      // Android 8+ entrega a notificacao no canal padrao, sem som nem vibracao.
      channelId: "isphub-avisos",
      priority: "high",
    }));

    const mortos: string[] = [];
    // O Expo recusa lotes grandes; o proprio SDK sabe o tamanho certo.
    for (const lote of expo.chunkPushNotifications(mensagens)) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await expo.sendPushNotificationsAsync(lote);
      } catch (err) {
        console.error("[push] falha ao enviar lote:", err);
        continue; // um lote ruim nao impede os outros
      }
      tickets.forEach((ticket, i) => {
        if (ticket.status !== "error") return;
        const destino = lote[i]?.to;
        if (ticket.details?.error === "DeviceNotRegistered" && typeof destino === "string") {
          mortos.push(destino);
        } else {
          console.error("[push] ticket com erro:", ticket.message, ticket.details?.error);
        }
      });
    }

    await limparTokensMortos(mortos);
  } catch (err) {
    console.error("[push] erro inesperado (ignorado):", err);
  }
}

/**
 * Atalho fire-and-forget para os pontos de emissao. Deixa explicito no ponto de
 * chamada que ninguem espera o push — e que uma falha nao volta como excecao.
 */
export function dispararPush(usuarioIds: string[], conteudo: PushConteudo): void {
  void enviarPush(usuarioIds, conteudo);
}
