import { describe, expect, it } from "vitest";
import { MAX_PARADAS_GOOGLE_MAPS, linkGoogleMaps, linkRotaGoogleMaps, linkWaze, temDestino } from "@isphub/shared";

describe("temDestino", () => {
  it("coordenada basta, inclusive zero", () => {
    expect(temDestino({ lat: 0, lng: 0 })).toBe(true);
  });
  it("qualquer pedaço de endereço basta", () => {
    expect(temDestino({ bairro: "Centro" })).toBe(true);
  });
  it("sem coordenada e sem texto não há destino", () => {
    expect(temDestino({ logradouro: "  ", cidade: null })).toBe(false);
    expect(temDestino(null)).toBe(false);
  });
  it("é exatamente o caso em que o link do Waze sairia vazio", () => {
    expect(linkWaze({})).toContain("q=&");
  });
});

describe("linkGoogleMaps / linkRotaGoogleMaps", () => {
  const rua = { logradouro: "Rua A", numero: "10", bairro: "Centro", cidade: "Natal" };

  it("coordenada vira lat,lng; sem coordenada vai o endereço codificado", () => {
    expect(linkGoogleMaps({ lat: -5.79, lng: -35.2 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-5.79%2C-35.2&travelmode=driving",
    );
    expect(linkGoogleMaps(rua)).toContain("destination=Rua%20A%2010%20Centro%20Natal");
  });

  it("rota: última parada é o destino, as anteriores viram waypoints na ordem, sem destino fica de fora", () => {
    const url = linkRotaGoogleMaps([{ lat: 1, lng: 2 }, null, { logradouro: "  " }, rua, { lat: 3, lng: 4 }])!;
    expect(url).toContain("destination=3%2C4");
    expect(url).toContain("waypoints=1%2C2%7CRua%20A%2010%20Centro%20Natal&");
  });

  it("uma parada só: sem waypoints; nenhuma: null", () => {
    expect(linkRotaGoogleMaps([rua])).not.toContain("waypoints");
    expect(linkRotaGoogleMaps([null, {}])).toBeNull();
  });

  it("corta em 10 paradas (limite do Google Maps)", () => {
    const paradas = Array.from({ length: 12 }, (_, i) => ({ lat: i, lng: i }));
    const url = linkRotaGoogleMaps(paradas)!;
    expect(url).toContain(`destination=${MAX_PARADAS_GOOGLE_MAPS - 1}%2C${MAX_PARADAS_GOOGLE_MAPS - 1}`);
    expect(url.split("%7C")).toHaveLength(MAX_PARADAS_GOOGLE_MAPS - 1);
  });
});
