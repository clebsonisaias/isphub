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
