import { Linking } from "react-native";
import { linkGoogleMaps, linkRotaGoogleMaps, linkWaze, type Endereco } from "@isphub/shared";

/**
 * Abre a navegacao no Waze ou no Google Maps.
 *
 * So o efeito colateral mora aqui — a montagem dos links e pura e vive em
 * `@isphub/shared` (`linkWaze`, `linkGoogleMaps`, `linkRotaGoogleMaps`), onde
 * tem teste. Existe pra que a home e o detalhe da OS nao carreguem copias disso.
 */
export function abrirNoWaze(endereco: Partial<Endereco> | null | undefined): void {
  void Linking.openURL(linkWaze(endereco));
}

export function abrirNoGoogleMaps(endereco: Partial<Endereco> | null | undefined): void {
  void Linking.openURL(linkGoogleMaps(endereco));
}

/** A rota do dia inteira (na ordem recebida) numa tela do Google Maps. */
export function abrirRotaNoGoogleMaps(enderecos: (Partial<Endereco> | null | undefined)[]): void {
  const url = linkRotaGoogleMaps(enderecos);
  if (url) void Linking.openURL(url);
}
