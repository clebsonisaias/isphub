import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, useMapEvents } from "react-leaflet";
import { EMOJI_VEICULO, idadeDaPosicao, posicaoVelha } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { AjustarLimites, BRASIL_CENTER, CamadaOsm } from "@/components/mapa/base";
import { veiculoIcon } from "@/components/mapa/veiculoIcon";
import { ChipsVeiculo } from "@/components/mapa/chipsVeiculo";
import { ReplayTrilha } from "@/components/mapa/ReplayTrilha";
import {
  cercasApi,
  frotaMapaApi,
  geocodeApi,
  type CercaVirtualDto,
  type PontoTrilha,
  type VeiculoNoMapa,
} from "@/lib/veiculosApi";
import { ApiError } from "@/lib/apiClient";
import { useRealtime } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { ChevronRight, MapPin, Plus, RefreshCw, Route, Shield, Trash2, Truck } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * MAPA DA FROTA — onde as viaturas estao agora, e por onde passaram.
 *
 * Duas decisoes que a tela carrega:
 *
 * 1. Toda posicao aparece com a IDADE dela. Um mapa que nao sabe dizer que esta
 *    velho e pior que nenhum mapa: o gestor despacha achando que o carro esta
 *    onde o pino mostra. A idade e medida contra `agoraServidor`, e nao contra o
 *    relogio do navegador, senao cada maquina mostraria um numero.
 *
 * 2. Poll de 30s MAIS o evento de tempo real. O evento so baixa a latencia; o
 *    intervalo e o piso, e e obrigatorio — o canal SSE nao tem buffer de replay,
 *    entao um stream morto e invisivel.
 *
 * Sem react-query: `lib/modulos.ts` documenta a queda de producao causada por um
 * `useQuery` sem QueryClient no provider da web.
 */

const INTERVALO_MS = 30_000;
const COR_PADRAO = "#6366f1";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

function CapturarCliqueCerca({ ativo, aoClicar }: { ativo: boolean; aoClicar: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (ativo) aoClicar(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function FrotaMapaPage() {
  const [veiculos, setVeiculos] = useState<VeiculoNoMapa[] | null>(null);
  const [agoraServidor, setAgoraServidor] = useState<Date>(() => new Date());
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [trilha, setTrilha] = useState<PontoTrilha[]>([]);
  const [indiceReplay, setIndiceReplay] = useState(0);
  const [carregandoTrilha, setCarregandoTrilha] = useState(false);
  const [cercas, setCercas] = useState<CercaVirtualDto[]>([]);
  const [modoNovaCerca, setModoNovaCerca] = useState(false);
  const [nomeNovaCerca, setNomeNovaCerca] = useState("");
  const [raioNovaCerca, setRaioNovaCerca] = useState(250);
  const [enderecos, setEnderecos] = useState<Record<string, string>>({});
  const buscando = useRef(false);

  const carregarCercas = useCallback(async () => {
    try {
      setCercas(await cercasApi.listar());
    } catch {
      // Cercas sao complementares ao mapa.
    }
  }, []);

  const carregar = useCallback(async () => {
    // Guarda de reentrancia: o poll e o evento podem coincidir, e duas buscas
    // simultaneas so gastam banda pra chegar na mesma resposta.
    if (buscando.current) return;
    buscando.current = true;
    try {
      const r = await frotaMapaApi.mapa();
      setVeiculos(r.veiculos);
      setAgoraServidor(new Date(r.agoraServidor));
      setErro(null);
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      buscando.current = false;
    }
  }, []);

  useEffect(() => {
    void carregar();
    void carregarCercas();
    const id = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(id);
  }, [carregar, carregarCercas]);

  const criarCercaNoClique = useCallback(
    async (lat: number, lng: number) => {
      const nome = nomeNovaCerca.trim() || `Cerca ${cercas.length + 1}`;
      try {
        const criada = await cercasApi.criar({
          nome,
          tipo: "circulo",
          centroLat: lat,
          centroLng: lng,
          raioMetros: raioNovaCerca,
        });
        setCercas((prev) => [criada, ...prev]);
        setModoNovaCerca(false);
        setNomeNovaCerca("");
      } catch {
        // Silencioso para nao interromper o fluxo do mapa.
      }
    },
    [nomeNovaCerca, raioNovaCerca, cercas.length],
  );

  const buscarEndereco = useCallback(async (veiculoId: string, lat: number, lng: number) => {
    if (enderecos[veiculoId]) return;
    try {
      const r = await geocodeApi.reverter(lat, lng);
      if (r.endereco) {
        setEnderecos((prev) => ({ ...prev, [veiculoId]: r.endereco! }));
      }
    } catch {
      // Geocodificacao e opcional.
    }
  }, [enderecos]);

  // O evento nao traz coordenada — e so "refaz tua busca". Ver o comentario em
  // `RealtimeEventoTipo`: carga no evento viraria uma segunda fonte de posicao.
  useRealtime((ev) => {
    if (ev.tipo === "posicao-veiculo" || ev.tipo === "ocupacao-alterada") void carregar();
  });

  const abrirTrilha = useCallback(async (veiculoId: string) => {
    setSelecionado(veiculoId);
    setCarregandoTrilha(true);
    try {
      setTrilha(await frotaMapaApi.trilha(veiculoId));
    } catch {
      setTrilha([]);
    } finally {
      setCarregandoTrilha(false);
    }
  }, []);

  const pontos: [number, number][] = (veiculos ?? []).map((v) => [v.lat, v.lng]);
  const linhaTrilha: [number, number][] = trilha.map((p) => [p.lat, p.lng]);
  const emMovimento = (veiculos ?? []).filter((v) => v.movendo).length;
  const semComunicacao = (veiculos ?? []).filter((v) => v.comunicando === false).length;
  // Bloqueado e o unico estado que muda o que o gestor FAZ agora — por isso
  // sobe pro cabecalho, junto com "sem comunicacao".
  const bloqueados = (veiculos ?? []).filter((v) => v.bloqueado === true).length;

  return (
    <AppShell>
      <AnimatedPage>
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 lg:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold">
                <Truck className="size-5 text-primary" aria-hidden />
                Frota ao vivo
              </h1>
              <p className="text-sm text-muted-foreground">
                {veiculos === null
                  ? "Carregando…"
                  : `${veiculos.length} com rastreador · ${emMovimento} em movimento` +
                    (semComunicacao > 0 ? ` · ${semComunicacao} sem comunicação` : "") +
                    (bloqueados > 0 ? ` · ${bloqueados} bloqueado${bloqueados > 1 ? "s" : ""}` : "")}
              </p>
            </div>
            <Button variant="ghost" onClick={() => void carregar()} aria-label="Atualizar agora">
              <RefreshCw className="size-4" aria-hidden />
              Atualizar
            </Button>
          </header>

          {erro ? (
            <ErrorState message={erro} onRetry={() => void carregar()} />
          ) : veiculos === null ? (
            <Skeleton className="h-[70vh] w-full rounded-xl" />
          ) : veiculos.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Nenhum veículo com rastreador vinculado ainda. Cadastre o rastreador em Frota → Rastreadores e vincule
                a um veículo.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="flex flex-col gap-2">
                <div className="overflow-hidden rounded-xl border border-border" style={{ height: "70vh" }}>
                  <MapContainer center={BRASIL_CENTER} zoom={4} style={{ height: "100%", width: "100%" }}>
                    <CamadaOsm />
                    <CapturarCliqueCerca ativo={modoNovaCerca} aoClicar={(lat, lng) => void criarCercaNoClique(lat, lng)} />
                    <AjustarLimites pontos={linhaTrilha.length > 1 ? linhaTrilha : pontos} />

                    {/* CERCAS VIRTUAIS ativas. */}
                    {cercas
                      .filter((c) => c.ativa)
                      .map((c) =>
                        c.tipo === "poligono" && c.vertices && c.vertices.length >= 3 ? (
                          <Polygon
                            key={c.id}
                            positions={c.vertices.map((p) => [p.lat, p.lng])}
                            pathOptions={{ color: c.cor, fillColor: c.cor, fillOpacity: 0.14, weight: 2 }}
                          >
                            <Popup>{c.nome}</Popup>
                          </Polygon>
                        ) : c.centroLat != null && c.centroLng != null && c.raioMetros != null ? (
                          <Circle
                            key={c.id}
                            center={[c.centroLat, c.centroLng]}
                            radius={c.raioMetros}
                            pathOptions={{ color: c.cor, fillColor: c.cor, fillOpacity: 0.14, weight: 2 }}
                          >
                            <Popup>
                              {c.nome} ({c.raioMetros} m)
                            </Popup>
                          </Circle>
                        ) : null,
                      )}

                    {/* O PERCURSO do veiculo selecionado. */}
                    {linhaTrilha.length > 1 ? (
                      <>
                        <Polyline positions={linhaTrilha} pathOptions={{ color: COR_PADRAO, weight: 4, opacity: 0.8 }} />
                        {/* Ponta inicial marcada: sem ela nao da pra saber o sentido. */}
                        <CircleMarker
                          center={linhaTrilha[0]!}
                          radius={6}
                          pathOptions={{ color: "#fff", fillColor: COR_PADRAO, fillOpacity: 1, weight: 2 }}
                        />
                        {trilha[indiceReplay] ? (
                          <CircleMarker
                            center={[trilha[indiceReplay]!.lat, trilha[indiceReplay]!.lng]}
                            radius={8}
                            pathOptions={{ color: "#fff", fillColor: "#f59e0b", fillOpacity: 1, weight: 3 }}
                          />
                        ) : null}
                      </>
                    ) : null}

                  {veiculos.map((v) => {
                    const velha = posicaoVelha(v.registradoEm, agoraServidor);
                    return (
                      <Marker
                        key={v.veiculoId}
                        position={[v.lat, v.lng]}
                        icon={veiculoIcon({ tipo: v.tipo, velha, movendo: v.movendo === true })}
                        eventHandlers={{ click: () => void abrirTrilha(v.veiculoId) }}
                      >
                        <Popup>
                          <p className="font-semibold tabular-nums">
                            <span className="mr-1" aria-hidden>
                              {EMOJI_VEICULO[v.tipo]}
                            </span>
                            {v.rotulo}
                          </p>
                          <p className="text-xs">{v.modelo}</p>
                          <p className="text-xs">
                            {v.velocidadeKmh != null ? `${Math.round(v.velocidadeKmh)} km/h` : "—"} ·{" "}
                            {idadeDaPosicao(v.registradoEm, agoraServidor)}
                          </p>
                          <ChipsVeiculo ignicao={v.ignicao} bateriaPct={v.bateriaPct} bloqueado={v.bloqueado} />
                          {enderecos[v.veiculoId] ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                              <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
                              {enderecos[v.veiculoId]}
                            </p>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void buscarEndereco(v.veiculoId, v.lat, v.lng)}
                              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <MapPin className="size-3" aria-hidden />
                              Ver endereço
                            </button>
                          )}
                          {v.ocupantes.length > 0 ? (
                            <p className="text-xs">Com: {v.ocupantes.join(", ")}</p>
                          ) : (
                            <p className="text-xs">Ninguém declarado a bordo</p>
                          )}
                          <Link
                            to={`/frota/veiculos/${v.veiculoId}`}
                            className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                          >
                            Sensores e viagens
                            <ChevronRight className="size-3" aria-hidden />
                          </Link>
                        </Popup>
                      </Marker>
                    );
                  })}
                </MapContainer>
                </div>
                <ReplayTrilha pontos={trilha} indice={indiceReplay} aoMudarIndice={setIndiceReplay} />
              </div>

              <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
                {veiculos.map((v) => {
                  const velha = posicaoVelha(v.registradoEm, agoraServidor);
                  return (
                    <li key={v.veiculoId}>
                      <button
                        type="button"
                        onClick={() => void abrirTrilha(v.veiculoId)}
                        className={cn(
                          "w-full rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-secondary/40",
                          selecionado === v.veiculoId && "border-primary bg-secondary/50",
                        )}
                      >
                        <p className="flex items-center justify-between gap-2">
                          <span className="font-semibold tabular-nums">
                            <span className="mr-1" aria-hidden>
                              {EMOJI_VEICULO[v.tipo]}
                            </span>
                            {v.rotulo}
                          </span>
                          {/* Ícone + texto, nunca só cor — quem não distingue
                              verde de cinza precisa do mesmo aviso. */}
                          <span
                            className={cn(
                              "text-xs",
                              velha ? "text-muted-foreground" : v.movendo ? "text-success" : "text-foreground",
                            )}
                          >
                            {v.movendo ? "em movimento" : "parado"}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {idadeDaPosicao(v.registradoEm, agoraServidor)}
                          {v.comunicando === false ? " · sem comunicação" : ""}
                        </p>
                        <ChipsVeiculo
                          ignicao={v.ignicao}
                          bateriaPct={v.bateriaPct}
                          bloqueado={v.bloqueado}
                          compacto
                        />
                        {v.ocupantes.length > 0 ? (
                          <p className="truncate text-xs text-muted-foreground">{v.ocupantes.join(", ")}</p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}

                {selecionado ? (
                  <li className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1 font-medium text-foreground">
                      <Route className="size-3.5" aria-hidden />
                      Percurso de hoje
                    </p>
                    <p>
                      {carregandoTrilha
                        ? "Carregando…"
                        : trilha.length > 1
                          ? `${trilha.length} pontos no traçado`
                          : "Sem percurso registrado hoje"}
                    </p>
                  </li>
                ) : null}

                <li className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <Shield className="size-3.5 text-primary" aria-hidden />
                      Cercas Virtuais ({cercas.length})
                    </span>
                    <Button
                      size="sm"
                      variant={modoNovaCerca ? "default" : "outline"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setModoNovaCerca((v) => !v)}
                    >
                      <Plus className="mr-1 size-3" aria-hidden />
                      {modoNovaCerca ? "Clique no mapa…" : "Nova cerca"}
                    </Button>
                  </div>
                  {modoNovaCerca ? (
                    <div className="mt-2 flex flex-col gap-1.5 rounded border border-dashed border-primary/50 bg-primary/5 p-2">
                      <input
                        type="text"
                        placeholder="Nome (ex.: Base Macaíba)"
                        value={nomeNovaCerca}
                        onChange={(e) => setNomeNovaCerca(e.target.value)}
                        className="rounded border border-border bg-background px-2 py-1 text-xs"
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Raio (m):</span>
                        <input
                          type="number"
                          min={20}
                          max={50000}
                          value={raioNovaCerca}
                          onChange={(e) => setRaioNovaCerca(Number(e.target.value) || 250)}
                          className="w-20 rounded border border-border bg-background px-2 py-1 text-xs"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">Clique no mapa para definir o centro.</p>
                    </div>
                  ) : null}
                  {cercas.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {cercas.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              const atualizada = await cercasApi.atualizar(c.id, { ativa: !c.ativa });
                              setCercas((prev) => prev.map((x) => (x.id === c.id ? atualizada : x)));
                            }}
                            className={cn("truncate text-left hover:underline", !c.ativa && "line-through opacity-50")}
                          >
                            {c.nome}
                          </button>
                          <button
                            type="button"
                            aria-label={`Excluir cerca ${c.nome}`}
                            onClick={async () => {
                              await cercasApi.excluir(c.id);
                              setCercas((prev) => prev.filter((x) => x.id !== c.id));
                            }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              </ul>
            </div>
          )}
        </div>
      </AnimatedPage>
    </AppShell>
  );
}
