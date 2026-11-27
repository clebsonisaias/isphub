import { useEffect } from "react";
import L from "leaflet";
import { TileLayer, useMap } from "react-leaflet";

/**
 * Pecas comuns aos mapas (fila de OS e frota).
 *
 * Extraidas do `MapaPage` sem mudanca de comportamento — o `mapa.spec.ts`
 * existente e a prova de que a mudanca foi pura. Existem aqui porque a segunda
 * tela de mapa chegou, e duas copias do mesmo enquadramento divergem: uma
 * ganharia o ajuste de zoom que a outra nao tem, e ninguem notaria.
 */

/**
 * Cor de tracado sobre o mapa (trilha, rota). FIXA, e nao o `--primary` do
 * tema: os tiles do mapa sao sempre claros, e o ciano do tema escuro
 * (#5CD4F4) some em cima deles. Este e o ciano fundo do tema claro, 5:1 sobre
 * o cinza do mapa. Tambem evita `var()` em atributo SVG, que o Leaflet nao
 * resolve.
 */
export const COR_TRACADO_MAPA = "#096c89";

export const BRASIL_CENTER: [number, number] = [-15.78, -47.93];

/** Camada de tiles padrao — OSM, sem chave e sem custo. */
export function CamadaOsm() {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
  );
}

/**
 * Enquadra o mapa nos pontos.
 *
 * Um ponto so nao tem "limites" — `fitBounds` de uma caixa degenerada leva ao
 * zoom maximo, e o operador cai na textura do asfalto sem referencia nenhuma.
 * Por isso o caso de 1 ponto usa `setView` com zoom de bairro.
 */
export function AjustarLimites({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pontos.length === 0) return;
    if (pontos.length === 1) {
      map.setView(pontos[0]!, 13);
      return;
    }
    map.fitBounds(L.latLngBounds(pontos), { padding: [40, 40] });
  }, [pontos, map]);
  return null;
}
