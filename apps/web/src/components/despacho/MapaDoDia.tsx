import { useCallback, useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Marker, Popup, Tooltip } from "react-leaflet";
import { OsStatus, idadeDaPosicao, posicaoVelha } from "@isphub/shared";
import { AjustarLimites, BRASIL_CENTER, CamadaOsm } from "@/components/mapa/base";
import { veiculoIcon } from "@/components/mapa/veiculoIcon";
import { frotaMapaApi, type VeiculoNoMapa } from "@/lib/veiculosApi";
import { useRealtime } from "@/lib/realtime";
import type { Parada } from "@/lib/despacho";

/**
 * O mapa do Despacho: as paradas do dia (cor da categoria, anel do prazo) e as
 * viaturas com rastreador, com quem esta a bordo. Mesma regra do mapa da Frota:
 * poll de 30s como piso e o evento de tempo real so pra baixar a latencia.
 * Sem modulo de frota (ou sem permissao), mostra so as paradas.
 */

const INTERVALO_MS = 30_000;
const COR_PRAZO = { vermelho: "#dc2626", amarelo: "#d97706" } as const;

export default function MapaDoDia({ paradas, aoAbrirOs }: { paradas: Parada[]; aoAbrirOs: (osId: string) => void }) {
  const [veiculos, setVeiculos] = useState<VeiculoNoMapa[]>([]);
  const [agoraServidor, setAgoraServidor] = useState(() => new Date());
  const [semFrota, setSemFrota] = useState(false);
  const buscando = useRef(false);

  const carregar = useCallback(async () => {
    if (buscando.current) return;
    buscando.current = true;
    try {
      const r = await frotaMapaApi.mapa();
      setVeiculos(r.veiculos);
      setAgoraServidor(new Date(r.agoraServidor));
      setSemFrota(false);
    } catch {
      setSemFrota(true);
    } finally {
      buscando.current = false;
    }
  }, []);

  useEffect(() => {
    void carregar();
    const id = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(id);
  }, [carregar]);

  useRealtime((ev) => {
    if (ev.tipo === "posicao-veiculo" || ev.tipo === "ocupacao-alterada") void carregar();
  });

  const comLugar = paradas.filter((p): p is Parada & { lat: number; lng: number } => p.lat != null && p.lng != null);
  const pontos: [number, number][] = [...comLugar.map((p) => [p.lat, p.lng] as [number, number]), ...veiculos.map((v) => [v.lat, v.lng] as [number, number])];
  const semLugar = paradas.length - comLugar.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="h-[380px] overflow-hidden rounded-lg border border-border">
        <MapContainer center={BRASIL_CENTER} zoom={4} style={{ height: "100%", width: "100%" }}>
          <CamadaOsm />
          <AjustarLimites pontos={pontos} />
          {comLugar.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={9}
              pathOptions={{
                color: p.sla === "vermelho" || p.sla === "amarelo" ? COR_PRAZO[p.sla] : "#ffffff",
                weight: p.sla === "vermelho" || p.sla === "amarelo" ? 4 : 2,
                fillColor: p.cor,
                fillOpacity: p.status === OsStatus.CONCLUIDA ? 0.35 : 1,
              }}
              eventHandlers={{ click: () => p.osId && aoAbrirOs(p.osId) }}
            >
              <Tooltip>
                <span className="font-semibold">{p.cliente ?? `OS ${p.sgpOsId}`}</span>
                <br />
                {p.categoria}, {p.local ?? "sem local"}
                <br />
                {p.tecnicoNome ?? "Sem técnico"}, {p.turno === "manha" ? "manhã" : "tarde"}
              </Tooltip>
            </CircleMarker>
          ))}
          {veiculos.map((v) => (
            <Marker
              key={v.veiculoId}
              position={[v.lat, v.lng]}
              icon={veiculoIcon({ tipo: v.tipo, velha: posicaoVelha(v.registradoEm, agoraServidor), movendo: v.movendo === true })}
            >
              <Popup>
                <p className="font-semibold tabular-nums">{v.rotulo}</p>
                <p className="text-xs">{v.ocupantes.length > 0 ? `Com ${v.ocupantes.join(", ")}` : "Ninguém declarado a bordo"}</p>
                <p className="text-xs">
                  {v.velocidadeKmh != null ? `${Math.round(v.velocidadeKmh)} km/h, ` : ""}
                  posição {idadeDaPosicao(v.registradoEm, agoraServidor)}
                </p>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        {comLugar.length} parada{comLugar.length === 1 ? "" : "s"} no mapa
        {semLugar > 0 ? `, ${semLugar} sem localização` : ""}.{" "}
        {semFrota ? "Viaturas indisponíveis (frota desligada ou sem acesso)." : `${veiculos.length} viatura${veiculos.length === 1 ? "" : "s"} com rastreador.`}
      </p>
    </div>
  );
}
