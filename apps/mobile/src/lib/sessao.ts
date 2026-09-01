import { API_BASE } from "./api-base";
import { tokenStore } from "./token-store";

/**
 * Dona da sessao do app: o par (access token, refresh token) e a renovacao.
 *
 * Existe como modulo, e nao dentro do `AuthProvider`, por um motivo concreto:
 * o token viaja como PARAMETRO (`apiFetch(path, { token })`, vindo do contexto
 * React). Depois de uma renovacao, todo caller que ja tinha o token na mao
 * ficaria com o antigo — e o retry precisa do novo. Um dono de modulo resolve
 * isso; o contexto acompanha por `assinarMudanca`.
 *
 * Mesmo desenho do painel (`apps/web/src/lib/apiClient.ts`), que ja adotou a
 * sessao longa e ja documentou as armadilhas.
 */

const TOKEN_KEY = "isphub_token";
const REFRESH_KEY = "isphub_refresh";

let accessToken: string | null = null;
let refreshToken: string | null = null;
/** `false` = a sessao vive so em memoria (escolha "nao salvar nada"). */
let persistir = true;

type Assinante = (access: string | null) => void;
const assinantes = new Set<Assinante>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

/** Liga/desliga a gravacao em disco. Desligar tambem APAGA o que ja estava la. */
export async function definirPersistencia(ligada: boolean): Promise<void> {
  persistir = ligada;
  if (!ligada) {
    await tokenStore.del(TOKEN_KEY);
    await tokenStore.del(REFRESH_KEY);
  }
}

export function assinarMudanca(fn: Assinante): () => void {
  assinantes.add(fn);
  return () => void assinantes.delete(fn);
}

/** Troca o par em memoria, persiste (se for o caso) e avisa os assinantes. */
export function setSessao(access: string | null, refresh: string | null): void {
  accessToken = access;
  refreshToken = refresh;
  if (persistir) {
    // Sem `await`: quem chama esta num caminho de UI e o disco nao pode
    // segurar a tela. Falha de escrita degrada pra "sessao so nesta abertura",
    // que e o mesmo que o modo "nao salvar" — nunca deixa o app travado.
    void (access ? tokenStore.set(TOKEN_KEY, access) : tokenStore.del(TOKEN_KEY));
    void (refresh ? tokenStore.set(REFRESH_KEY, refresh) : tokenStore.del(REFRESH_KEY));
  }
  for (const fn of assinantes) fn(access);
}

/** Le o par guardado no aparelho (boot do app). */
export async function carregarSessaoGuardada(): Promise<{ access: string | null; refresh: string | null }> {
  const [access, refresh] = await Promise.all([tokenStore.get(TOKEN_KEY), tokenStore.get(REFRESH_KEY)]);
  accessToken = access;
  refreshToken = refresh;
  return { access, refresh };
}

/**
 * UMA renovacao por vez, compartilhada por todos os chamadores.
 *
 * O app dispara varias queries juntas no boot (fila, agenda, resumo, jornada,
 * config) e, com o access vencido, TODAS tomam 401 no mesmo instante. Sem esta
 * promessa unica, cada uma dispararia sua propria rotacao — e como o refresh e
 * ROTATIVO, a segunda apresentaria um token que a primeira acabou de queimar.
 * O servidor tem 30s de graca pra isso; fora da janela ele trata como token
 * clonado e derruba TODAS as sessoes do usuario (`revogarTudoDoUsuario`). Ou
 * seja: o preco do descuido do cliente e o tecnico deslogado no meio da rua.
 */
let renovacaoEmCurso: Promise<boolean> | null = null;

export function renovarSessao(): Promise<boolean> {
  if (renovacaoEmCurso) return renovacaoEmCurso;

  renovacaoEmCurso = (async () => {
    const atual = refreshToken;
    if (!atual) return false;
    try {
      /*
       * `fetch` cru, NUNCA `apiFetch`: passar por ele criaria recursao — um 401
       * aqui tentaria renovar de novo, sem fim, contra a rota que tem
       * refreshLimiter.
       */
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: atual }),
      });
      if (!res.ok) {
        // Resposta do servidor dizendo nao: a sessao morreu de verdade
        // (expirada, revogada, ou reuso detectado). Limpar e o certo.
        setSessao(null, null);
        return false;
      }
      const data = (await res.json()) as { token?: string; refreshToken?: string };
      if (!data.token || !data.refreshToken) {
        // 200 malformado nao pode virar "renovou": o app seguiria com o token
        // velho achando que renovou, e o proximo 401 nao teria o que tentar.
        return false;
      }
      setSessao(data.token, data.refreshToken);
      return true;
    } catch {
      /*
       * Falha de REDE nao e sessao invalida. Apagar aqui deslogaria o tecnico
       * exatamente quando ele esta sem sinal — ou seja, sem como logar de novo.
       * Devolver `false` faz a chamada original propagar o 401 dela, e a
       * proxima tentativa (com sinal) renova normalmente.
       */
      return false;
    }
  })();

  try {
    return renovacaoEmCurso;
  } finally {
    void renovacaoEmCurso.finally(() => {
      renovacaoEmCurso = null;
    });
  }
}

export type DesfechoDesbloqueio = "entrou" | "pedir-senha" | "sem-rede";

/**
 * O que fazer quando a biometria passou mas a sessao nao veio.
 *
 * A distincao entre "o servidor disse nao" e "eu nao consegui perguntar" e a
 * razao de existir desta funcao, e ela ja custou confianca uma vez: o codigo
 * antigo tratava QUALQUER falha como sessao morta e apagava a preferencia de
 * biometria junto. Um tunel sem sinal desligava a digital do tecnico de forma
 * permanente — e ele nao le isso como "sem rede", le como "essa porcaria nao
 * funciona", e nao liga de novo.
 *
 * `sem-rede` nao autoriza mexer em NADA: nem na sessao, nem na preferencia.
 * Tenta de novo quando houver sinal.
 */
export function desfechoDoDesbloqueio(entrou: boolean, servidorRespondeu: boolean): DesfechoDesbloqueio {
  if (entrou) return "entrou";
  return servidorRespondeu ? "pedir-senha" : "sem-rede";
}
