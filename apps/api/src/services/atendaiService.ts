import { prisma } from "../lib/prisma.js";
import { decrypt } from "../lib/crypto.js";

/**
 * Cliente do AtendAI — a plataforma de atendimento dos provedores.
 *
 * A chave e POR PROVEDOR porque do outro lado ela pertence a um tenant. E e
 * isso que faz a regra do produto funcionar: a OS diz o provedor, o provedor
 * diz a chave, a chave diz o tenant, e o tecnico cai no cliente certo.
 *
 * Provedor sem AtendAI nao e erro — e o estado normal de quem nao contratou a
 * plataforma. Por isso a resolucao devolve `null` e o chamador cai no caminho
 * atual (canal WhatsApp proprio do ISPhub) em vez de ver uma excecao.
 */

/** Timeout curto de proposito: ver `chamar`. */
const TIMEOUT_MS = 8_000;

/** Onde o `chatExternoRouter` esta montado no AtendAI (`server.ts`). */
const BASE_PATH = "/api/externo/v1";

export interface CredencialAtendai {
  baseUrl: string;
  chave: string;
  segredo: string | null;
}

type LinhaConfig = {
  baseUrl: string;
  chaveCifrada: string;
  segredoCifrado: string | null;
  ativo: boolean;
} | null;

/**
 * A parte que decide, separada da que faz rede — e por isso testavel sem
 * mockar nada.
 *
 * Config ausente OU desativada dao o mesmo resultado (`null`): desligar o
 * AtendAI de um provedor tem que ter exatamente o efeito de nunca o ter
 * ligado, senao "desativado" viraria um terceiro estado que ninguem previu.
 */
export function credencialDe(linha: LinhaConfig): CredencialAtendai | null {
  if (!linha || !linha.ativo) return null;
  return {
    baseUrl: linha.baseUrl.replace(/\/+$/, ""),
    chave: decrypt(linha.chaveCifrada),
    segredo: linha.segredoCifrado ? decrypt(linha.segredoCifrado) : null,
  };
}

/** A credencial do provedor, ou `null` quando ele nao usa AtendAI. */
export async function credencialDoProvedor(provedorId: string): Promise<CredencialAtendai | null> {
  const linha = await prisma.atendaiConfig.findUnique({
    where: { provedorId },
    select: { baseUrl: true, chaveCifrada: true, segredoCifrado: true, ativo: true },
  });
  return credencialDe(linha);
}

export class AtendaiIndisponivel extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AtendaiIndisponivel";
  }
}

/**
 * Uma chamada a API externa do AtendAI, em nome de um provedor.
 *
 * **Timeout de 8s, e curto de proposito.** O AtendAI e outro sistema, com outro
 * deploy e outra janela de manutencao. A fila do tecnico nao pode ficar refem
 * do uptime dele: sem teto, uma indisponibilidade la vira tela travada aqui, no
 * meio da rua.
 */
export async function chamar<T>(
  cred: CredencialAtendai,
  metodo: "GET" | "POST" | "DELETE",
  caminho: string,
  corpo?: unknown,
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cred.baseUrl}${BASE_PATH}${caminho}`, {
      method: metodo,
      /*
       * `Authorization: Bearer ak_…`, conferido no `middleware/apiKey.ts` do
       * AtendAI. Nao e `X-API-Key`: com o header errado a chamada volta 401 e
       * o sintoma parece chave invalida, mandando quem for depurar caçar no
       * cadastro em vez de no cabecalho.
       */
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cred.chave}` },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let msg = `AtendAI HTTP ${res.status}`;
      try {
        // AtendAI responde `{ erro: <codigo>, mensagem: <texto> }`: o texto explica.
        const j = (await res.json()) as { erro?: string; mensagem?: string; message?: string };
        msg = j.mensagem ?? j.erro ?? j.message ?? msg;
      } catch {
        // corpo nao-JSON — mantem a mensagem HTTP
      }
      throw new AtendaiIndisponivel(res.status, msg);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}
