import type { AlertButton } from "react-native";

/** As caixas nativas do navegador — `window` serve; o teste passa uma falsa. */
export interface CaixasDoNavegador {
  alert(texto: string): void;
  confirm(texto: string): boolean;
  prompt(texto: string, padrao?: string): string | null;
}

/**
 * `Alert.alert` com as caixas do navegador. O react-native-web implementa
 * `Alert.alert` como funcao VAZIA: no PWA, "Encerrar jornada?", "Sair" e todo
 * aviso de erro simplesmente nao aconteciam — o botao ficava mudo.
 *
 * - so aviso (sem acao, ou uma acao sem "cancelar"): alert, depois a acao;
 * - uma acao + cancelar: confirm;
 * - duas ou mais acoes: o navegador nao tem caixa com botoes livres — numera.
 *
 * Mora sem import de runtime do react-native pra caber no vitest (ver
 * evidencias/limites.ts); quem liga no `Alert` e o `app/_layout.tsx`.
 */
export function alertaNoNavegador(caixas: CaixasDoNavegador, titulo: string, mensagem?: string, botoes?: AlertButton[]): void {
  const texto = [titulo, mensagem].filter(Boolean).join("\n\n");
  const cancelar = botoes?.find((b) => b.style === "cancel");
  const acoes = (botoes ?? []).filter((b) => b !== cancelar);

  if (acoes.length === 0) {
    caixas.alert(texto);
    cancelar?.onPress?.();
    return;
  }
  if (acoes.length === 1) {
    if (!cancelar) {
      caixas.alert(texto);
      acoes[0].onPress?.();
      return;
    }
    (caixas.confirm(texto) ? acoes[0] : cancelar).onPress?.();
    return;
  }
  const lista = acoes.map((b, i) => `${i + 1}. ${b.text ?? ""}`).join("\n");
  const escolha = acoes[Number(caixas.prompt(`${texto}\n\n${lista}`, "1")) - 1];
  (escolha ?? cancelar)?.onPress?.();
}
