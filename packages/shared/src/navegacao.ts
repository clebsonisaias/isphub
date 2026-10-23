import type { Endereco } from "./types.js";

/**
 * Levar o tecnico ate o cliente.
 *
 * O sistema NAO calcula rota nem tempo estimado: quem faz isso e o Waze, que ja
 * tem transito, desvio e navegacao por voz — e ja esta aberto no painel do
 * carro. Calcular aqui exigiria chave paga do Google e devolveria um numero
 * pior que o do app que a pessoa vai usar de qualquer jeito.
 *
 * Mora em `shared` (e nao no app) porque e pura e precisa de teste: e a unica
 * parte desta feature que erra em SILENCIO. Um esquema errado ou um endereco
 * mal codificado nao estoura — o botao so nao faz nada, e ninguem descobre ate
 * um tecnico reclamar do meio da rua.
 */

/**
 * Universal link do Waze — `https://`, nunca o esquema `waze://`.
 *
 * O esquema proprio falha em silencio em aparelho sem o app: o `Linking`
 * rejeita e o botao vira decoracao. O `https` abre o app quando ele existe e a
 * versao web quando nao.
 *
 * `navigate=yes` pula a confirmacao e ja inicia a rota — quem tocou "Abrir no
 * Waze" numa OS ja decidiu pra onde vai.
 */
export function linkWaze(endereco: Partial<Endereco> | null | undefined): string {
  const lat = endereco?.lat;
  const lng = endereco?.lng;
  // `!= null` e nao truthy: `lat: 0` e falsy, e um `if (lat && lng)` mandaria
  // uma coordenada valida pro ramo de texto.
  if (lat != null && lng != null) {
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }
  /*
   * Sem coordenada, manda o endereco por texto — o Waze resolve. E comum, nao
   * excecao: a listagem de OS do SGP nao traz geo; so o backfill do cadastro
   * preenche, e nem sempre consegue.
   */
  const texto = [endereco?.logradouro, endereco?.numero, endereco?.bairro, endereco?.cidade]
    .filter(Boolean)
    .join(" ");
  return `https://waze.com/ul?q=${encodeURIComponent(texto)}&navigate=yes`;
}

/**
 * Ha para onde navegar? Coordenada OU algum pedaco de endereco. Sem nada disso
 * o `linkWaze` monta `q=` vazio e o Waze abre sem destino — o botao vira uma
 * promessa quebrada. A tela esconde o botao em vez de oferecer isso.
 */
export function temDestino(endereco: Partial<Endereco> | null | undefined): boolean {
  if (endereco?.lat != null && endereco?.lng != null) return true;
  return [endereco?.logradouro, endereco?.numero, endereco?.bairro, endereco?.cidade].some((p) => !!p?.trim());
}

/** Destino como o Google Maps entende: "lat,lng" ou o endereco em texto. */
function destinoGoogle(endereco: Partial<Endereco> | null | undefined): string {
  if (endereco?.lat != null && endereco?.lng != null) return `${endereco.lat},${endereco.lng}`;
  return [endereco?.logradouro, endereco?.numero, endereco?.bairro, endereco?.cidade].filter(Boolean).join(" ");
}

/**
 * Rota no Google Maps de onde o tecnico esta ate o cliente — o Maps mostra as
 * duas posicoes. Alternativa ao Waze (nem todo aparelho tem). Mesmo cuidado do
 * `linkWaze`: universal link `https://`, que abre o app quando existe.
 */
export function linkGoogleMaps(endereco: Partial<Endereco> | null | undefined): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinoGoogle(endereco))}&travelmode=driving`;
}

/**
 * O Google Maps aceita no maximo 9 paradas intermediarias (waypoints) num link:
 * com o destino final, sao 10 paradas.
 */
export const MAX_PARADAS_GOOGLE_MAPS = 10;

/**
 * A rota do dia numa tela so do Google Maps: paradas na ordem recebida, a
 * ultima vira o destino e as anteriores os waypoints. Parada sem destino fica
 * de fora; sem nenhuma, `null` (a tela esconde o botao).
 * ponytail: passou de 10 paradas, o link leva as 10 primeiras; o resto sai
 * num segundo toque depois que essas forem concluidas.
 */
export function linkRotaGoogleMaps(enderecos: (Partial<Endereco> | null | undefined)[]): string | null {
  const pontos = enderecos.filter(temDestino).slice(0, MAX_PARADAS_GOOGLE_MAPS).map(destinoGoogle);
  if (pontos.length === 0) return null;
  const destino = encodeURIComponent(pontos[pontos.length - 1]);
  const waypoints = pontos.slice(0, -1).map(encodeURIComponent).join("%7C");
  return `https://www.google.com/maps/dir/?api=1&destination=${destino}${waypoints ? `&waypoints=${waypoints}` : ""}&travelmode=driving`;
}
