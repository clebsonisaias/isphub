import L from "leaflet";
import { EMOJI_VEICULO, type TipoVeiculo } from "@isphub/shared";

/**
 * Pino de VEICULO no mapa.
 *
 * Construido por API de DOM, nunca por string de HTML — a mesma razao que o
 * `pinIcon` da fila documenta.
 *
 * O pictograma e um EMOJI e carrega o TIPO do veiculo (carro, moto, van,
 * caminhao). O quadradinho anterior nao dizia isso: num patio com carro e moto,
 * todos os pinos eram iguais.
 *
 * Como emoji tem cor FIXA, ele nao pode carregar estado — entao os estados
 * continuam no HALO em volta, e nao no desenho:
 *
 *   halo cinza + esmaecido   posicao velha ou sem comunicacao — nao confie no pino
 *   halo verde               em movimento agora
 *   sombra discreta          parado, com posicao recente
 *
 * O estado nunca depende SO de cor: a lista ao lado do mapa diz "em movimento"
 * / "parado" / "sem comunicação" por extenso, e o popup traz a idade da posicao.
 */
export function veiculoIcon(opts: { tipo: TipoVeiculo; velha: boolean; movendo: boolean }): L.DivIcon {
  const caixa = document.createElement("div");
  // 44px de area de toque em volta de um glifo de ~26px: o alvo do dedo nao
  // pode ter o tamanho do desenho.
  caixa.style.width = "44px";
  caixa.style.height = "44px";
  caixa.style.display = "flex";
  caixa.style.alignItems = "center";
  caixa.style.justifyContent = "center";

  const disco = document.createElement("div");
  disco.style.width = "36px";
  disco.style.height = "36px";
  disco.style.borderRadius = "50%";
  // Disco claro por baixo: emoji sobre foto de satelite ou sobre rua clara some
  // sem um fundo proprio.
  disco.style.background = "rgba(255,255,255,.92)";
  disco.style.display = "flex";
  disco.style.alignItems = "center";
  disco.style.justifyContent = "center";
  disco.style.fontSize = "20px";
  disco.style.lineHeight = "1";
  disco.style.boxShadow = opts.velha
    ? "0 0 0 3px rgba(148,163,184,.6)"
    : opts.movendo
      ? "0 0 0 3px rgba(34,197,94,.55)"
      : "0 1px 5px rgba(0,0,0,.4)";
  if (opts.velha) disco.style.opacity = "0.6";

  // `textContent`, e nao innerHTML: o emoji vem de um mapa fechado, mas a regra
  // da casa e nunca montar marcador por string.
  disco.textContent = EMOJI_VEICULO[opts.tipo] ?? EMOJI_VEICULO.carro;

  caixa.appendChild(disco);
  return L.divIcon({ className: "", html: caixa, iconSize: [44, 44], iconAnchor: [22, 22] });
}
