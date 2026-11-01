/**
 * APP UNICO, TELA PELO PAPEL. O tecnico usa as telas nativas (fila, OS,
 * evidencias offline, GPS); todo o resto — vendedor, gestor, admin, atendente,
 * provedor — usa o painel web dentro do app (tela `/painel`), ja logado.
 *
 * Logica pura, com teste. O painel decide a propria tela inicial pelo papel
 * (apps/web/src/lib/inicioPorPapel.ts); aqui so se escolhe nativo x painel.
 */

/** Onde o painel mora. Sobrescrevivel pra testar contra um painel local. */
export const PAINEL_URL = (process.env.EXPO_PUBLIC_PAINEL_URL ?? "https://painel.isphub.net.br").replace(/\/+$/, "");

/** So o tecnico tem telas nativas; papel desconhecido (sem /auth/me ainda) fica no nativo. */
export function usaTelasNativas(role: string | null | undefined): boolean {
  return !role || role === "tecnico";
}

export function destinoDoPapel(role: string | null | undefined): "/minhas-os" | "/painel" {
  return usaTelasNativas(role) ? "/minhas-os" : "/painel";
}

/**
 * Toque numa notificacao, para quem esta no painel: o caminho do painel que
 * abre a conversa/OS certa. Mesmo `data` que a API manda (pushService).
 */
export function caminhoNoPainelDoPush(dados: unknown): string | null {
  if (!dados || typeof dados !== "object") return null;
  const d = dados as { tela?: string; conversaId?: string; osId?: string };
  const q = (id?: string) => (id ? `?conversa=${encodeURIComponent(id)}` : "");
  switch (d.tela) {
    case "chat":
      return `/chat${q(d.conversaId)}`;
    case "chat-clientes":
      return `/chat-clientes${q(d.conversaId)}`;
    case "os":
      return d.osId ? `/os/${encodeURIComponent(d.osId)}` : "/";
    default:
      return null;
  }
}

/** Mensagens que o painel manda pela ponte do WebView (apps/web/src/lib/modoApp.ts). */
export type MensagemPainel = { tipo: "saiu" } | { tipo: "abrir"; url: string };

export function lerMensagemPainel(bruto: string): MensagemPainel | null {
  try {
    const m = JSON.parse(bruto) as Partial<{ tipo: string; url: unknown }>;
    if (m.tipo === "saiu") return { tipo: "saiu" };
    if (m.tipo === "abrir" && typeof m.url === "string" && /^(https?|tel|mailto|whatsapp):/i.test(m.url)) {
      return { tipo: "abrir", url: m.url };
    }
    return null;
  } catch {
    return null;
  }
}

/** O link fica no painel (mesma origem, blob/about) ou abre fora do app? */
export function ficaNoPainel(url: string): boolean {
  if (/^(about:|blob:|data:)/i.test(url)) return true;
  try {
    return new URL(url).origin === new URL(PAINEL_URL).origin;
  } catch {
    return false;
  }
}

/**
 * O que o app grava no painel antes de a pagina carregar. A `marca` evita o
 * pior caso: recarregar a pagina reinjetar um refresh JA ROTACIONADO pelo
 * painel — a API trataria como roubo e derrubaria todas as sessoes. Com a
 * marca, a sessao so e gravada uma vez por abertura do app.
 */
export function scriptDeSessao(sessao: { token: string; refreshToken: string; marca: string }): string {
  const j = JSON.stringify;
  return `(function(){
  window.ISPHUB_APP = true;
  try {
    if (localStorage.getItem("isphub_app_marca") !== ${j(sessao.marca)}) {
      localStorage.setItem("isphub_token", ${j(sessao.token)});
      localStorage.setItem("isphub_refresh", ${j(sessao.refreshToken)});
      localStorage.setItem("isphub_app_marca", ${j(sessao.marca)});
    }
  } catch (e) {}
})(); true;`;
}
