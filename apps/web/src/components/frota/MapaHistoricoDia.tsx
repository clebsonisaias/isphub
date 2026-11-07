import { useMemo } from "react";
import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, Popup, Tooltip } from "react-leaflet";
import type { ParadaDoDia } from "@isphub/shared";
import { AjustarLimites, BRASIL_CENTER, CamadaOsm } from "@/components/mapa/base";
import type { PontoTrilha } from "@/lib/veiculosApi";

/**
 * O percurso de UM dia, com as paradas numeradas.
 *
 * Separado (e carregado sob demanda) porque traz o Leaflet: quem abre a pagina
 * do veiculo so pra ver os sensores nao paga pelo mapa.
 */

const COR = "#6366f1";

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function duracao(seg: number) {
  const m = Math.round(seg / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export default function MapaHistoricoDia({ trilha, paradas }: { trilha: PontoTrilha[]; paradas: ParadaDoDia[] }) {
  const linha = useMemo<[number, number][]>(() => trilha.map((p) => [p.lat, p.lng]), [trilha]);
  /*
   * Enquadra so quando o DIA muda (a trilha e outra), nunca a cada render: o
   * array e memorizado, entao o `AjustarLimites` nao desfaz o zoom do gestor.
   */
  const enquadrar = useMemo<[number, number][]>(
    () => (linha.length > 0 ? linha : paradas.map((p) => [p.lat, p.lng] as [number, number])),
    [linha, paradas],
  );

  return (
    <div className="h-72 overflow-hidden rounded-lg border border-border sm:h-96">
      <MapContainer center={BRASIL_CENTER} zoom={4} style={{ height: "100%", width: "100%" }}>
        <CamadaOsm />
        <AjustarLimites pontos={enquadrar} />
        {linha.length > 1 ? (
          <>
            <Polyline positions={linha} pathOptions={{ color: COR, weight: 4, opacity: 0.8 }} />
            <CircleMarker center={linha[0]!} radius={6} pathOptions={{ color: "#fff", fillColor: "#16a34a", fillOpacity: 1, weight: 2 }}>
              <Tooltip>Saída · {hora(trilha[0]!.em)}</Tooltip>
            </CircleMarker>
            <CircleMarker
              center={linha[linha.length - 1]!}
              radius={6}
              pathOptions={{ color: "#fff", fillColor: "#dc2626", fillOpacity: 1, weight: 2 }}
            >
              <Tooltip>Último ponto · {hora(trilha[trilha.length - 1]!.em)}</Tooltip>
            </CircleMarker>
          </>
        ) : null}
        {paradas.map((p, i) => (
          <CircleMarker
            key={p.inicioEm}
            center={[p.lat, p.lng]}
            radius={9}
            pathOptions={{ color: "#fff", fillColor: "#f59e0b", fillOpacity: 1, weight: 2 }}
          >
            <Tooltip permanent direction="center" className="!border-0 !bg-transparent !p-0 !shadow-none text-[11px] font-bold">
              {i + 1}
            </Tooltip>
            <Popup>
              Parada {i + 1}: {hora(p.inicioEm)} → {hora(p.fimEm)} ({duracao(p.duracaoSeg)})
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
