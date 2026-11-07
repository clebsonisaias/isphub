import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { diaBrasileiroIso, formatarDistancia, type HistoricoDoDia, type ParadaDoDia, type ViagemDoDia } from "@isphub/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { api } from "@/lib/apiClient";
import { frotaMapaApi } from "@/lib/veiculosApi";
import { ChevronLeft, ChevronRight, Route } from "lucide-react";

const MapaHistoricoDia = lazy(() => import("./MapaHistoricoDia"));

/**
 * O HISTORICO DE UM DIA do veiculo: mapa do percurso com as paradas, viagens
 * (horario, km, velocidade maxima, marcha lenta, motorista) e o km do dia.
 */

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function duracao(seg: number) {
  const m = Math.round(seg / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

function somarDias(dia: string, n: number) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function rotuloDia(dia: string, hoje: string) {
  if (dia === hoje) return "Hoje";
  if (dia === somarDias(hoje, -1)) return "Ontem";
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

type Item = ({ tipo: "viagem"; v: ViagemDoDia } | { tipo: "parada"; p: ParadaDoDia }) & { n: number; t: number };

/** Viagens e paradas intercaladas, na ordem do dia. */
function intercalar(viagens: ViagemDoDia[], paradas: ParadaDoDia[]): Item[] {
  const itens: Item[] = [
    ...viagens.map((v, i) => ({ tipo: "viagem" as const, v, n: i + 1, t: Date.parse(v.inicioEm) })),
    ...paradas.map((p, i) => ({ tipo: "parada" as const, p, n: i + 1, t: Date.parse(p.inicioEm) })),
  ];
  return itens.sort((a, b) => a.t - b.t);
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

export function HistoricoDiaCard({ veiculoId }: { veiculoId: string }) {
  const hoje = diaBrasileiroIso(new Date());
  const [dia, setDia] = useState(hoje);
  const ehHoje = dia === hoje;

  const historico = useQuery({
    queryKey: ["frota", "historico", veiculoId, dia],
    queryFn: () => api.get<HistoricoDoDia>(`/frota/veiculos/${veiculoId}/historico?dia=${dia}`),
    // So hoje muda. Dia passado e fato consumado: nao re-busca. O React Query
    // ja pausa o intervalo com a aba escondida.
    refetchInterval: ehHoje ? 60_000 : false,
    staleTime: ehHoje ? 30_000 : Infinity,
  });
  const trilha = useQuery({
    queryKey: ["frota", "trilha", veiculoId, dia],
    enabled: !!historico.data,
    queryFn: () => frotaMapaApi.trilha(veiculoId, { de: historico.data!.inicio, ate: historico.data!.fim }),
    refetchInterval: ehHoje ? 60_000 : false,
    staleTime: ehHoje ? 30_000 : Infinity,
  });

  const h = historico.data;
  const t = h?.totais;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="size-4 text-primary" aria-hidden />
            Histórico do dia
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Dia anterior" onClick={() => setDia(somarDias(dia, -1))}>
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Label htmlFor="dia-historico" className="sr-only">
              Dia
            </Label>
            <Input
              id="dia-historico"
              type="date"
              className="w-40"
              value={dia}
              max={hoje}
              onChange={(e) => e.target.value && setDia(e.target.value > hoje ? hoje : e.target.value)}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Próximo dia"
              disabled={ehHoje}
              onClick={() => setDia(somarDias(dia, 1))}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
        <p className="text-sm capitalize text-muted-foreground">{rotuloDia(dia, hoje)}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {historico.isError ? (
          <ErrorState message="Não foi possível carregar o histórico deste dia." onRetry={() => void historico.refetch()} />
        ) : !h || !t ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Numero rotulo="Km do dia" valor={formatarDistancia(t.distanciaMetros)} />
              <Numero rotulo="Viagens" valor={String(t.viagens)} />
              <Numero rotulo="Em movimento" valor={duracao(t.emMovimentoSeg)} />
              <Numero rotulo="Vel. máxima" valor={t.velocidadeMaxKmh != null ? `${Math.round(t.velocidadeMaxKmh)} km/h` : "—"} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t.motoristas.length > 0 ? `Dirigiu: ${t.motoristas.join(", ")}` : "Nenhum motorista declarado neste dia"}
              {t.paradoComMotorLigadoSeg >= 60 ? ` · ${duracao(t.paradoComMotorLigadoSeg)} parado com o motor ligado` : ""}
            </p>

            {trilha.isError ? (
              <ErrorState message="Não foi possível carregar o percurso." onRetry={() => void trilha.refetch()} />
            ) : t.viagens === 0 ? null : (
              <Suspense fallback={<Skeleton className="h-72 w-full sm:h-96" />}>
                {trilha.data ? (
                  <MapaHistoricoDia trilha={trilha.data} paradas={h.paradas} />
                ) : (
                  <Skeleton className="h-72 w-full sm:h-96" />
                )}
              </Suspense>
            )}

            {t.viagens === 0 ? (
              <p className="text-sm text-muted-foreground">
                {ehHoje ? "O carro ainda não rodou hoje." : "O carro não rodou neste dia."} Uma viagem começa quando a
                ignição liga.
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {intercalar(h.viagens, h.paradas).map((item) =>
                  item.tipo === "viagem" ? (
                    <li key={`v-${item.v.id}`} className="rounded-lg border border-border p-2.5 text-sm">
                      <p className="flex items-center justify-between gap-2 tabular-nums">
                        <span className="font-medium">
                          Viagem {item.n} · {hora(item.v.inicioEm)} → {item.v.fimEm ? hora(item.v.fimEm) : "em curso"}
                        </span>
                        <span>{item.v.distanciaMetros != null ? formatarDistancia(item.v.distanciaMetros) : "—"}</span>
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {item.v.motorista ?? "motorista não declarado"}
                        {item.v.velocidadeMaxKmh != null ? ` · máx ${Math.round(item.v.velocidadeMaxKmh)} km/h` : ""}
                        {item.v.paradoComMotorLigadoSeg && item.v.paradoComMotorLigadoSeg >= 60
                          ? ` · ${duracao(item.v.paradoComMotorLigadoSeg)} parado com o motor ligado`
                          : ""}
                      </p>
                    </li>
                  ) : (
                    <li
                      key={`p-${item.p.inicioEm}`}
                      className="flex items-center gap-2 px-2.5 text-xs text-muted-foreground tabular-nums"
                    >
                      <span
                        className="inline-flex size-5 items-center justify-center rounded-full bg-warning/20 font-semibold text-foreground"
                        aria-hidden
                      >
                        {item.n}
                      </span>
                      Parada {item.n}: {hora(item.p.inicioEm)} → {hora(item.p.fimEm)} · {duracao(item.p.duracaoSeg)}
                    </li>
                  ),
                )}
              </ol>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
