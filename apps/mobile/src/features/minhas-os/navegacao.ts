import { Linking } from "react-native";
import { linkWaze, type Endereco } from "@isphub/shared";

/**
 * Abre a navegacao no Waze.
 *
 * So o efeito colateral mora aqui — a montagem do link e pura e vive em
 * `@isphub/shared` (`linkWaze`), onde tem teste. Existe pra que a home e o
 * detalhe da OS nao carreguem copias disso: antes desta fase, `abrirMapa`
 * estava duplicado nos dois, cada um com o seu jeito de montar a URL.
 */
export function abrirNoWaze(endereco: Partial<Endereco> | null | undefined): void {
  void Linking.openURL(linkWaze(endereco));
}
