import { useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { FilaItem, Provedor } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";
import { UserRole } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { filaApi } from "@/lib/filaApi";
import { provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";

type OsItem = Extract<FilaItem, { kind: "os" }>;

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/**
 * Pin colorido com a cor do provedor (evita depender dos icones default do
 * Leaflet). Monta o elemento via DOM API (nao interpolando `cor` numa string
 * HTML) para nao depender so da validacao do backend contra a cor conter markup.
 */
function pinIcon(cor: string) {
  const span = document.createElement("span");
  span.style.display = "block";
  span.style.width = "16px";
  span.style.height = "16px";
  span.style.borderRadius = "9999px";
  span.style.backgroundColor = cor;
  span.style.border = "2px solid white";
  span.style.boxShadow = "0 1px 4px rgba(0,0,0,.5)";
  return L.divIcon({ className: "", html: span, iconSize: [16, 16], iconAnchor: [8, 8] });
}

const BRASIL_CENTER: [number, number] = [-15.78, -47.93];

function AjustarLimites({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pontos.length === 0) return;
    if (pontos.length === 1) {
      map.setView(pontos[0], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(pontos), { padding: [40, 40] });
  }, [pontos, map]);
  return null;
}

export function MapaPage() {
  const { usuario } = useAuth();
  const { toast } = useToast();
  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [provedorId, setProvedorId] = useState("");
  const [itens, setItens] = useState<OsItem[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    provedoresApi.listar().then(setProvedores).catch(() => {});
  }, []);

  useEffect(() => {
    setCarregando(true);
    filaApi
      .listar({ provedorId: provedorId || undefined, pageSize: 500 })
      .then((resp) => {
        const comCoordenadas = resp.itens.filter(
          (i): i is OsItem => i.kind === "os" && i.endereco.lat != null && i.endereco.lng != null,
        );
        setItens(comCoordenadas);
      })
      .catch((err) => toast({ titulo: "Erro ao carregar o mapa", descricao: mensagem(err), variante: "erro" }))
      .finally(() => setCarregando(false));
  }, [provedorId]);

  const pontos = useMemo<[number, number][]>(
    () => itens.map((i) => [i.endereco.lat as number, i.endereco.lng as number]),
    [itens],
  );

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Mapa</h1>
          <p className="text-sm text-muted-foreground">
            {itens.length} {itens.length === 1 ? "OS geolocalizada" : "OS geolocalizadas"}
          </p>
        </div>
        {usuario?.role !== UserRole.PROVEDOR && usuario?.role !== UserRole.TECNICO && (
          <select
            value={provedorId}
            onChange={(e) => setProvedorId(e.target.value)}
            className="h-10 rounded-md border border-input bg-secondary/40 px-3 text-sm"
          >
            <option value="">Todos os provedores</option>
            {provedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border" style={{ height: "70vh" }}>
          <MapContainer center={BRASIL_CENTER} zoom={4} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <AjustarLimites pontos={pontos} />
            {itens.map((item) => (
              <Marker
                key={item.id}
                position={[item.endereco.lat as number, item.endereco.lng as number]}
                icon={pinIcon(item.provedor.cor)}
              >
                <Popup>
                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-1">
                      <ProvedorBadge provedor={item.provedor} />
                      <StatusBadge status={item.status} />
                      <ContratoStatusBadge status={item.contratoStatus} />
                    </div>
                    {item.categoria && (
                      <span className="inline-flex w-fit items-center gap-1 text-xs font-medium" style={{ color: item.categoria.cor }}>
                        {item.categoria.nome}
                      </span>
                    )}
                    <p className="font-medium">{item.clienteNome ?? "Cliente não identificado"}</p>
                    <p className="text-muted-foreground">
                      {item.endereco.logradouro
                        ? `${item.endereco.logradouro}, ${item.endereco.numero} — ${item.endereco.bairro}`
                        : item.pop
                          ? `Localização (POP): ${item.pop}`
                          : "Localização não informada"}
                    </p>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}
    </AppShell>
  );
}
