/**
 * MODO APP — o painel aberto dentro do app ISPhub (WebView do app Expo).
 *
 * O app injeta `window.ISPHUB_APP = true` (e a sessao) antes de a pagina
 * carregar. Aqui ficam as poucas diferencas de comportamento:
 * - sem service worker: dentro do app ele so serviria para entregar bundle velho;
 * - o painel AVISA o app quando a pessoa sai (o app volta ao login nativo);
 * - link para fora do painel abre no navegador/app do celular, nao dentro do
 *   WebView (que nao tem barra de endereco nem botao de voltar pra ele).
 */

/** Mensagens que o app entende (ver apps/mobile/src/features/painel). */
export type MensagemApp = { tipo: "saiu" } | { tipo: "abrir"; url: string };

interface JanelaApp {
  ISPHUB_APP?: boolean;
  ReactNativeWebView?: { postMessage: (dados: string) => void };
}

export function emApp(janela: unknown = typeof window !== "undefined" ? window : undefined): boolean {
  return (janela as JanelaApp | undefined)?.ISPHUB_APP === true;
}

export function avisarApp(msg: MensagemApp, janela: unknown = typeof window !== "undefined" ? window : undefined): void {
  const j = janela as JanelaApp | undefined;
  if (!emApp(j)) return;
  try {
    j?.ReactNativeWebView?.postMessage(JSON.stringify(msg));
  } catch {
    // app antigo sem a ponte: segue sem aviso
  }
}

/**
 * Este link sai do painel? Mesma origem = navega dentro do app; outra origem
 * ou outro esquema (tel:, mailto:, whatsapp:) = abre fora. `blob:` e `data:`
 * nao tem como abrir fora (o arquivo so existe nesta pagina) — fica dentro.
 */
export function abreFora(href: string, origemPainel: string): boolean {
  let url: URL;
  try {
    url = new URL(href, origemPainel);
  } catch {
    return false;
  }
  if (url.protocol === "blob:" || url.protocol === "data:" || url.protocol === "javascript:") return false;
  return url.origin !== new URL(origemPainel).origin;
}

/**
 * Liga o modo app: link externo e `window.open` viram aviso pro app. Chamado
 * uma vez no boot, so quando `emApp()`.
 */
export function ligarModoApp(janela: Window = window): void {
  const origem = janela.location.origin;
  janela.document.addEventListener(
    "click",
    (ev) => {
      const a = (ev.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (a.target === "_blank" || abreFora(href, origem)) {
        if (!abreFora(href, origem) && a.target === "_blank") {
          // Mesma origem em "_blank": abre dentro, na propria aba.
          ev.preventDefault();
          janela.location.assign(new URL(href, origem).toString());
          return;
        }
        ev.preventDefault();
        avisarApp({ tipo: "abrir", url: new URL(href, origem).toString() }, janela);
      }
    },
    true,
  );
  const abrirOriginal = janela.open.bind(janela);
  janela.open = ((url?: string | URL, ...resto: unknown[]) => {
    const href = url ? String(url) : "";
    if (href && abreFora(href, origem)) {
      avisarApp({ tipo: "abrir", url: new URL(href, origem).toString() }, janela);
      return null;
    }
    return abrirOriginal(url, ...(resto as [string?, string?]));
  }) as typeof janela.open;
}
