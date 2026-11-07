import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, CircleMarker } from "react-leaflet";
import { EMOJI_VEICULO, diaBrasileiroIso, idadeDaPosicao, limitesDoDia, posicaoVelha } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { AjustarLimites, BRASIL_CENTER, CamadaOsm } from "@/components/mapa/base";
import { veiculoIcon } from "@/components/mapa/veiculoIcon";
import { ChipsVeiculo } from "@/components/mapa/chipsVeiculo";
import { frotaMapaApi, type PontoTrilha, type VeiculoNoMapa } from "@/lib/veiculosApi";
import { ApiError } from "@/lib/apiClient";
import { useRealtime } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { ChevronRight, RefreshCw, Route, Truck } from "lucide-react";
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

export function FrotaMapaPage() {
  const [veiculos, setVeiculos] = useState<VeiculoNoMapa[] | null>(null);
  const [agoraServidor, setAgoraServidor] = useState<Date>(() => new Date());
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [trilha, setTrilha] = useState<PontoTrilha[]>([]);
  const [carregandoTrilha, setCarregandoTrilha] = useState(false);
  /** Dia do percurso ("AAAA-MM-DD", fuso de Brasilia). As posicoes ao vivo sao sempre de agora. */
  const hoje = diaBrasileiroIso(new Date());
  const [dia, setDia] = useState(hoje);
  // So a resposta do ULTIMO pedido vale: trocar de carro ou de dia rapido nao
  // pode deixar a trilha do anterior na tela.
  const pedidoTrilha = useRef(0);
  const buscando = useRef(false);

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
    const id = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(id);
  }, [carregar]);

  // O evento nao traz coordenada — e so "refaz tua busca". Ver o comentario em
  // `RealtimeEventoTipo`: carga no evento viraria uma segunda fonte de posicao.
  useRealtime((ev) => {
    if (ev.tipo === "posicao-veiculo" || ev.tipo === "ocupacao-alterada") void carregar();
  });

  const abrirTrilha = useCallback(
    async (veiculoId: string, doDia: string = dia) => {
      const meu = ++pedidoTrilha.current;
      setSelecionado(veiculoId);
      setCarregandoTrilha(true);
      try {
        const { inicio, fim } = limitesDoDia(doDia);
        const t = await frotaMapaApi.trilha(veiculoId, { de: inicio.toISOString(), ate: fim.toISOString() });
        if (meu === pedidoTrilha.current) setTrilha(t);
      } catch {
        if (meu === pedidoTrilha.current) setTrilha([]);
      } finally {
        if (meu === pedidoTrilha.current) setCarregandoTrilha(false);
      }
    },
    [dia],
  );

  function trocarDia(novo: string) {
    const d = novo > hoje ? hoje : novo;
    setDia(d);
    if (selecionado) void abrirTrilha(selecionado, d);
  }

  /*
   * Enquadramento ESTAVEL: os carros so reenquadram quando a frota muda (entra
   * ou sai carro), nao a cada atualizacao de 30 s — antes o zoom do gestor numa
   * viatura era desfeito sozinho a cada poll.
   */
  const idsFrota = (veiculos ?? []).map((v) => v.veiculoId).join(",");
  const pontos = useMemo<[number, number][]>(() => (veiculos ?? []).map((v) => [v.lat, v.lng]), [idsFrota]);
  const linhaTrilha = useMemo<[number, number][]>(() => trilha.map((p) => [p.lat, p.lng]), [trilha]);
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
            <div className="flex items-center gap-2">
              <Label htmlFor="dia-percurso" className="text-sm text-muted-foreground">
                Percurso do dia
              </Label>
              <Input
                id="dia-percurso"
                type="date"
                className="w-40"
                value={dia}
                max={hoje}
                onChange={(e) => e.target.value && trocarDia(e.target.value)}
              />
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
              <div className="overflow-hidden rounded-xl border border-border" style={{ height: "70vh" }}>
                <MapContainer center={BRASIL_CENTER} zoom={4} style={{ height: "100%", width: "100%" }}>
                  <CamadaOsm />
                  <AjustarLimites pontos={linhaTrilha.length > 1 ? linhaTrilha : pontos} />

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
                      Percurso {dia === hoje ? "de hoje" : `de ${new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-BR")}`}
                    </p>
                    <p>
                      {carregandoTrilha
                        ? "Carregando…"
                        : trilha.length > 1
                          ? `${trilha.length} pontos no traçado`
                          : "Sem percurso registrado neste dia"}
                    </p>
                    <Link
                      to={`/frota/veiculos/${selecionado}`}
                      className="mt-1 inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                    >
                      Viagens e paradas do dia
                      <ChevronRight className="size-3" aria-hidden />
                    </Link>
                  </li>
                ) : null}
              </ul>
            </div>
          )}
        </div>
      </AnimatedPage>
    </AppShell>
  );
}
