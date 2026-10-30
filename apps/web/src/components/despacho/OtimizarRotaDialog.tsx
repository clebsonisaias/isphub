import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/context/ToastContext";
import { logisticaApi, type SugestaoRotaDto } from "@/lib/logisticaApi";
import {
  Zap,
  Route,
  ArrowRight,
  TrendingDown,
  Clock,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Fuel,
} from "lucide-react";

export function OtimizarRotaDialog({
  aberto,
  tecnicoId,
  tecnicoNome,
  dia,
  turno,
  onFechar,
  onAplicado,
}: {
  aberto: boolean;
  tecnicoId: string | null;
  tecnicoNome: string;
  dia: string;
  turno?: "manha" | "tarde" | "dia_inteiro";
  onFechar: () => void;
  onAplicado: () => void;
}) {
  const { toast } = useToast();
  const [carregando, setCarregando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [dados, setDados] = useState<SugestaoRotaDto | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || !tecnicoId) return;

    let ativo = true;
    setCarregando(true);
    setErro(null);

    logisticaApi
      .obterSugestaoRota(tecnicoId, dia, turno)
      .then((res) => {
        if (ativo) setDados(res);
      })
      .catch((err) => {
        if (ativo) setErro(err?.message ?? "Falha ao calcular rota otimizada.");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [aberto, tecnicoId, dia, turno]);

  async function aplicar() {
    if (!tecnicoId || !dados || dados.ordemSugeridaIds.length === 0) return;

    setAplicando(true);
    try {
      await logisticaApi.aplicarOrdemRota(tecnicoId, dados.ordemSugeridaIds);
      toast({
        variante: "sucesso",
        titulo: "Rota otimizada aplicada!",
        descricao: `A nova sequência de ${dados.paradas.length} paradas já foi sincronizada para ${tecnicoNome}.`,
      });
      onAplicado();
      onFechar();
    } catch (err: unknown) {
      toast({
        variante: "erro",
        titulo: "Erro ao aplicar rota",
        descricao: err instanceof Error ? err.message : "Falha ao atualizar ordem das paradas.",
      });
    } finally {
      setAplicando(false);
    }
  }

  const paradasOrdenadas = dados
    ? [...dados.paradas].sort((a, b) => a.ordemSugerida - b.ordemSugerida)
    : [];

  const jaEstaOtimizada =
    dados &&
    dados.kmEconomizado <= 0.1 &&
    dados.ordemAtualIds.join(",") === dados.ordemSugeridaIds.join(",");

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg overflow-hidden sm:max-w-xl">
        <DialogHeader className="border-b border-border pb-3">
          <div className="flex items-center gap-2 text-primary">
            <Route className="size-5" />
            <DialogTitle className="text-lg font-bold">
              Roteirização Inteligente · {tecnicoNome}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Otimização matemática do trajeto para reduzir quilometragem, tempo e consumo de combustível.
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">
              Traçando a melhor sequência de paradas...
            </p>
          </div>
        ) : erro ? (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="size-5 shrink-0" />
            <p>{erro}</p>
          </div>
        ) : dados ? (
          <div className="space-y-4 py-2">
            {/* Card de Economia de Combustível e Tempo */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <TrendingDown className="size-3.5" />
                  KM Poupado
                </span>
                <p className="mt-1 text-2xl font-black text-emerald-600 dark:text-emerald-400">
                  {dados.kmEconomizado > 0 ? `-${dados.kmEconomizado} km` : "0 km"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {dados.kmAtual} km → <strong className="text-foreground">{dados.kmSugerido} km</strong>
                </p>
              </div>

              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  <Clock className="size-3.5" />
                  Tempo Estimado
                </span>
                <p className="mt-1 text-2xl font-black text-blue-600 dark:text-blue-400">
                  {dados.minutosEconomizados > 0 ? `~${dados.minutosEconomizados} min` : "No ideal"}
                </p>
                <p className="text-[11px] text-muted-foreground">tempo poupado na rota</p>
              </div>

              <div className="col-span-2 rounded-xl border border-border bg-secondary/30 p-3 sm:col-span-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Fuel className="size-3.5 text-amber-500" />
                  Combustível
                </span>
                <p className="mt-1 text-xl font-bold text-foreground">
                  {dados.kmEconomizado > 0
                    ? `~${(dados.kmEconomizado / 10).toFixed(1)} L`
                    : "Ideal"}
                </p>
                <p className="text-[11px] text-muted-foreground">economia estimada</p>
              </div>
            </div>

            {/* Origem da rota */}
            {dados.origem && (
              <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                <MapPin className="size-4 shrink-0 text-primary" />
                <span>
                  Partida considerada: <strong>{dados.origem.descricao}</strong>
                </span>
              </div>
            )}

            {jaEstaOtimizada && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4 shrink-0" />
                <span>Esta rota já está na melhor sequência calculada! Nenhum zigue-zague detectado.</span>
              </div>
            )}

            {/* Lista com a sequência sugerida */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sequência Proposta ({paradasOrdenadas.length} paradas)
              </span>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {paradasOrdenadas.map((p) => {
                  const mudou = p.ordemAtual !== p.ordemSugerida;
                  return (
                    <div
                      key={p.agendamentoId}
                      className={`flex items-center justify-between p-2.5 text-xs transition-colors ${
                        mudou ? "bg-amber-500/5 dark:bg-amber-500/10" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-white text-[11px]">
                          {p.ordemSugerida}º
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-foreground">
                            {p.cliente ?? `OS ${p.sgpOsId}`}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {p.categoria ?? "OS"} {p.bairro ? `· ${p.bairro}` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {p.ordemAtual != null ? (
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                              mudou
                                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold"
                                : "text-muted-foreground"
                            }`}
                          >
                            era {p.ordemAtual}º
                          </span>
                        ) : (
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            sem ordem
                          </span>
                        )}
                        {mudou && <ArrowRight className="size-3 text-amber-500" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={onFechar} disabled={aplicando}>
            Fechar
          </Button>
          <Button
            size="sm"
            onClick={() => void aplicar()}
            disabled={carregando || aplicando || !dados || paradasOrdenadas.length === 0}
            className="gap-1.5"
          >
            {aplicando ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Zap className="size-3.5" />
            )}
            Aplicar Rota Otimizada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
