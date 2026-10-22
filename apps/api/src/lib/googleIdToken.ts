import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

/**
 * Confere um ID token do Google (OpenID Connect): o Apps Script do robo da
 * planilha se identifica com `ScriptApp.getIdentityToken()`, assinado pelo
 * Google com o e-mail de quem roda o script. Assim nao existe segredo nenhum
 * pra colar no script nem pra vazar — quem nao tem a conta nao gera o token.
 *
 * Verifica assinatura RS256 contra as chaves publicas do Google, emissor,
 * validade e e-mail verificado. Quem pode entrar (e-mail) decide quem chama.
 */

const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const EMISSORES = ["accounts.google.com", "https://accounts.google.com"];

export type ChaveGoogle = JsonWebKey & { kid: string };

let cache: { chaves: ChaveGoogle[]; expiraEm: number } | null = null;

async function chavesDoGoogle(): Promise<ChaveGoogle[]> {
  // O Google roda as chaves em dias; 1 h de cache e folga de sobra.
  if (cache && cache.expiraEm > Date.now()) return cache.chaves;
  const r = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`chaves do Google indisponiveis (${r.status})`);
  const chaves = ((await r.json()) as { keys: ChaveGoogle[] }).keys;
  cache = { chaves, expiraEm: Date.now() + 3_600_000 };
  return chaves;
}

const json = (parte: string) => JSON.parse(Buffer.from(parte, "base64url").toString("utf8"));

export interface IdentidadeGoogle {
  email: string;
  /** Cliente OAuth que pediu o token (o projeto do Apps Script) — da pra fixar depois. */
  aud: string;
}

/** Identidade do token, ou null se ele nao e um ID token do Google valido agora. */
export async function verificarIdTokenGoogle(
  token: string,
  opcoes: { agora?: number; chaves?: ChaveGoogle[] } = {},
): Promise<IdentidadeGoogle | null> {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const cab = json(partes[0]!);
    if (cab.alg !== "RS256") return null;
    const chave = (opcoes.chaves ?? (await chavesDoGoogle())).find((k) => k.kid === cab.kid);
    if (!chave) return null;
    const assinaturaOk = createVerify("RSA-SHA256")
      .update(`${partes[0]}.${partes[1]}`)
      .verify(createPublicKey({ key: chave, format: "jwk" }), Buffer.from(partes[2]!, "base64url"));
    if (!assinaturaOk) return null;

    const c = json(partes[1]!);
    const agora = Math.floor((opcoes.agora ?? Date.now()) / 1000);
    if (!EMISSORES.includes(c.iss)) return null;
    if (typeof c.exp !== "number" || c.exp < agora - 60) return null; // 60 s de tolerancia de relogio
    if (c.email_verified !== true || typeof c.email !== "string") return null;
    return { email: c.email.toLowerCase(), aud: String(c.aud) };
  } catch {
    return null;
  }
}
