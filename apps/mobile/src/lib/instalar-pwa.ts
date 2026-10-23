import { useEffect, useState } from "react";

/** O evento `beforeinstallprompt` do Chrome (não vem tipado no DOM do TypeScript). */
interface PedidoInstalacao extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type JanelaPwa = Window & { __pedidoInstalacao?: PedidoInstalacao | null };

export type ModoInstalacao = "botao" | "dica-ios" | null;

/**
 * O que a tela de login oferece para instalar o PWA:
 * - "botao": o Chrome/Android entregou o pedido de instalação;
 * - "dica-ios": iPhone/iPad não têm pedido — só "Compartilhar → Adicionar à Tela de Início";
 * - null: já aberto como app instalado, ou navegador sem instalação.
 *
 * Sem import do react-native de propósito: cabe no vitest (ver evidencias/limites.ts).
 */
export function modoInstalacao(a: { instalado: boolean; temPedido: boolean; userAgent: string; toques: number }): ModoInstalacao {
  if (a.instalado) return null;
  if (a.temPedido) return "botao";
  // O iPad (iPadOS) se apresenta como Mac; o que entrega é a tela de toque.
  const ehIOS = /iPhone|iPad|iPod/.test(a.userAgent) || (/Macintosh/.test(a.userAgent) && a.toques > 1);
  return ehIOS ? "dica-ios" : null;
}

function lerAmbiente(): ModoInstalacao {
  if (typeof document === "undefined") return null; // APK: não há o que instalar
  const nav = navigator as Navigator & { standalone?: boolean };
  return modoInstalacao({
    instalado: window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true,
    temPedido: !!(window as JanelaPwa).__pedidoInstalacao,
    userAgent: nav.userAgent,
    toques: nav.maxTouchPoints ?? 0,
  });
}

/** O pedido é guardado cedo pelo public/index.html (o Chrome só o entrega uma vez). */
export function useInstalarPwa(): { modo: ModoInstalacao; instalar: () => Promise<void> } {
  const [modo, setModo] = useState<ModoInstalacao>(lerAmbiente);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const atualizar = () => setModo(lerAmbiente());
    window.addEventListener("isphub-instalavel", atualizar);
    return () => window.removeEventListener("isphub-instalavel", atualizar);
  }, []);

  async function instalar() {
    const janela = window as JanelaPwa;
    const pedido = janela.__pedidoInstalacao;
    if (!pedido) return;
    await pedido.prompt();
    await pedido.userChoice;
    janela.__pedidoInstalacao = null; // vale uma vez só, aceito ou não
    setModo(lerAmbiente());
  }

  return { modo, instalar };
}
