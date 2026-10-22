import { createSign } from "node:crypto";

/**
 * Leitura de UM arquivo do Google Drive com conta de servico (so leitura).
 *
 * Fluxo OAuth "service account": assina um JWT com a chave privada da conta,
 * troca por um access token e usa no Drive. Feito com o crypto do Node — a
 * googleapis inteira pra duas chamadas GET seria peso morto.
 *
 * A conta precisa ter recebido acesso ao arquivo (compartilhar com o e-mail
 * dela como leitor). Escopo `drive.readonly`: ela nao consegue alterar nada.
 */

export interface ContaServico {
  client_email: string;
  private_key: string;
}

const ESCOPO = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** JWT de asserção (RS256) que o Google troca por access token. Exportado pra teste. */
export function assinarAssercao(conta: ContaServico, agora = Date.now()): string {
  const iat = Math.floor(agora / 1000);
  const cabecalho = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64url(JSON.stringify({ iss: conta.client_email, scope: ESCOPO, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const assinatura = createSign("RSA-SHA256").update(`${cabecalho}.${corpo}`).sign(conta.private_key);
  return `${cabecalho}.${corpo}.${b64url(assinatura)}`;
}

let cache: { token: string; expiraEm: number } | null = null;

async function token(conta: ContaServico): Promise<string> {
  // Token vale 1 h; renova com folga de 5 min. O robo roda a cada 15 min.
  if (cache && cache.expiraEm - 300_000 > Date.now()) return cache.token;
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assinarAssercao(conta) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Google recusou a conta de servico (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const d = (await r.json()) as { access_token: string; expires_in: number };
  cache = { token: d.access_token, expiraEm: Date.now() + d.expires_in * 1000 };
  return d.access_token;
}

async function chamar(conta: ContaServico, url: string): Promise<Response> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await token(conta)}` }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) {
    // 404 aqui quase sempre e "arquivo nao compartilhado com a conta de servico".
    throw new Error(`Drive respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return r;
}

const BASE = "https://www.googleapis.com/drive/v3/files";

/** Quando o arquivo mudou pela ultima vez — o robo pula a rodada se nao mudou. */
export async function modificadoEm(conta: ContaServico, arquivoId: string): Promise<string> {
  const r = await chamar(conta, `${BASE}/${encodeURIComponent(arquivoId)}?fields=modifiedTime&supportsAllDrives=true`);
  return ((await r.json()) as { modifiedTime: string }).modifiedTime;
}

/** Bytes do arquivo como esta no Drive (o .xlsx cru). */
export async function baixar(conta: ContaServico, arquivoId: string): Promise<Buffer> {
  const r = await chamar(conta, `${BASE}/${encodeURIComponent(arquivoId)}?alt=media&supportsAllDrives=true`);
  return Buffer.from(await r.arrayBuffer());
}
