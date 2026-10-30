import { useEffect, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Polyline, Popup } from "react-leaflet";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CamadaOsm, AjustarLimites, BRASIL_CENTER } from "@/components/mapa/base";
import { logisticaApi, type MinhaRotaDoDiaDto, type MinhaRotaDoDiaParadaDto } from "@/lib/logisticaApi";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Navigation,
  Clock,
  Loader2,
  AlertCircle,
} from "lucide-react";

function criarIconeNumero(numero: number, ehPrimeiro: boolean) {
  const corBg = ehPrimeiro ? "#10b981" : "#2563eb";
  const html = `
    <div style="
      background-color: ${corBg};
      color: white;
      font-weight: 800;
      font-size: 13px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
      border: 2px solid white;
    ">
      ${numero}
    </div>
  `;
  return L.divIcon({
    className: "rota-numero-marker",
    html,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export function RotaDoDiaModal({
  aberto,
  onFechar,
  onAbrirOs,
}: {
  aberto: boolean;
  onFechar: () => void;
  onAbrirOs?: (osId: string) => void;
}) {
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState<MinhaRotaDoDiaDto | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    let ativo = true;
    setCarregando(true);
    setErro(null);

    logisticaApi
      .obterMinhaRotaDoDia()
      .then((res) => {
        if (ativo) setDados(res);
      })
      .catch((err) => {
        if (ativo) {
          console.warn("[RotaDoDiaModal] Falha ao carregar rota:", err);
          setErro("Não foi possível carregar a rota do dia.");
        }
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [aberto]);

  // Pontos com coordenadas válidas para traçado da linha e enquadramento
  const pontosComCoordenadas = useMemo(() => {
    if (!dados) return [];
    return dados.paradas
      .filter((p): p is MinhaRotaDoDiaParadaDto & { lat: number; lng: number } => p.lat != null && p.lng != null)
      .map((p) => [p.lat, p.lng] as [number, number]);
  }, [dados]);

  const abrirGoogleMaps = () => {
    if (dados?.googleMapsUrl) {
      window.open(dados.googleMapsUrl, "_blank");
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="fixed inset-0 z-50 flex h-full w-full max-w-none flex-col overflow-hidden bg-background p-0 sm:inset-auto sm:h-[88vh] sm:max-h-[820px] sm:max-w-md sm:rounded-2xl sm:border sm:shadow-2xl">
        {/* Top bar teal escuro */}
        <div className="relative flex shrink-0 items-center justify-between bg-teal-950 px-4 py-3.5 text-white">
          <button
            type="button"
            onClick={onFechar}
            className="flex size-10 items-center justify-center rounded-full text-white/90 hover:bg-white/10 active:scale-95 transition-all"
            aria-label="Voltar"
          >
            <ChevronLeft className="size-6" />
          </button>

          <h2 className="text-base font-bold tracking-tight text-white">Rota do dia</h2>

          <div className="size-10" />
        </div>

        {/* Corpo principal */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {carregando ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Traçando sua melhor rota do dia...</p>
            </div>
          ) : erro ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-destructive">
              <AlertCircle className="size-8" />
              <p className="text-sm font-medium">{erro}</p>
              <Button variant="outline" size="sm" onClick={() => onFechar()}>
                Voltar
              </Button>
            </div>
          ) : dados ? (
            <>
              {/* Área do Mapa (Topo) */}
              <div className="relative h-[44%] w-full shrink-0 overflow-hidden bg-secondary/30">
                {/* Card flutuante sobre o mapa */}
                <div className="pointer-events-none absolute left-3 right-3 top-3 z-[1000] flex justify-center">
                  <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border/80 bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur-md">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400">
                      <Calendar className="size-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground leading-tight">
                        {dados.diaFormatado}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                        {dados.totalParadas} {dados.totalParadas === 1 ? "ordem de serviço" : "ordens de serviço"}
                        {dados.totalKm > 0 ? ` · ${dados.totalKm} km estimados` : ""}
                      </p>
                    </div>
                  </div>
                </div>

                <MapContainer
                  center={pontosComCoordenadas[0] ?? BRASIL_CENTER}
                  zoom={13}
                  className="h-full w-full"
                  zoomControl={false}
                >
                  <CamadaOsm />
                  <AjustarLimites pontos={pontosComCoordenadas} />

                  {/* Linha azul conectando as paradas na ordem ótima */}
                  {pontosComCoordenadas.length >= 2 && (
                    <Polyline
                      positions={pontosComCoordenadas}
                      pathOptions={{
                        color: "#2563eb",
                        weight: 4,
                        opacity: 0.85,
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                    />
                  )}

                  {/* Marcadores numerados */}
                  {dados.paradas.map((p, idx) => {
                    if (p.lat == null || p.lng == null) return null;
                    const ehPrimeiro = idx === 0;
                    return (
                      <Marker
                        key={p.agendamentoId}
                        position={[p.lat, p.lng]}
                        icon={criarIconeNumero(idx + 1, ehPrimeiro)}
                      >
                        <Popup>
                          <div className="p-1 text-xs">
                            <strong className="block font-bold">
                              #{idx + 1} - OS {p.sgpOsId}
                            </strong>
                            <p className="text-muted-foreground">{p.cliente}</p>
                            <p className="text-[11px] text-muted-foreground">{p.enderecoFormatado}</p>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </MapContainer>
              </div>

              {/* Bottom Sheet com as Paradas e Botão Google Maps */}
              <div className="relative flex flex-1 flex-col overflow-hidden rounded-t-3xl border-t border-border/80 bg-background shadow-xl">
                {/* Puxador da sheet */}
                <div className="flex justify-center pt-2.5 pb-1">
                  <div className="h-1.5 w-10 rounded-full bg-muted" />
                </div>

                {/* Lista de paradas com scroll */}
                <div className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-border/50">
                  {dados.paradas.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                      <Clock className="size-8 opacity-40 mb-2" />
                      <p className="text-sm font-semibold">Nenhuma O.S. agendada para hoje.</p>
                      <p className="text-xs">As novas ordens despachadas aparecerão aqui automaticamente.</p>
                    </div>
                  ) : (
                    dados.paradas.map((parada, idx) => {
                      const ehPrimeira = idx === 0;
                      return (
                        <div
                          key={parada.agendamentoId}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (onAbrirOs && parada.osId) {
                              onAbrirOs(parada.osId);
                            }
                          }}
                          className="flex items-center gap-3.5 py-3 transition-colors hover:bg-secondary/40 active:bg-secondary/60 cursor-pointer text-left"
                        >
                          {/* Círculo com o número */}
                          <div
                            className={`flex size-10 shrink-0 items-center justify-center rounded-full font-black text-sm text-white shadow-xs ${
                              ehPrimeira ? "bg-emerald-500" : "bg-blue-600"
                            }`}
                          >
                            {idx + 1}
                          </div>

                          {/* Info da OS */}
                          <div className="min-w-0 flex-1">
                            <h4 className="truncate text-sm font-bold text-foreground">
                              OS #{parada.sgpOsId} - {parada.cliente}
                            </h4>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="size-3 text-muted-foreground" />
                                {parada.horarioPrevisto}
                              </span>
                              {parada.bairro && (
                                <span className="truncate">· {parada.bairro}</span>
                              )}
                            </div>
                          </div>

                          {/* Distância e Seta */}
                          <div className="flex shrink-0 items-center gap-1.5">
                            {parada.distanciaTrechoKm != null && (
                              <span className="text-xs font-semibold text-muted-foreground">
                                {parada.distanciaTrechoKm} km
                              </span>
                            )}
                            <ChevronRight className="size-4 text-muted-foreground/60" />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Rodapé fixo com Botão "Abrir no Google Maps" */}
                <div className="border-t border-border/80 bg-background/95 p-4 backdrop-blur-sm pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <Button
                    onClick={abrirGoogleMaps}
                    disabled={!dados.googleMapsUrl || dados.paradas.length === 0}
                    className="h-12 w-full rounded-2xl bg-emerald-600 text-white font-bold text-base shadow-lg shadow-emerald-600/25 hover:bg-emerald-700 active:scale-[0.99] transition-all flex items-center justify-center gap-2.5"
                  >
                    <Navigation className="size-5 fill-current" />
                    Abrir no Google Maps
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
