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
import { logisticaApi, type ProximidadeTecnicosDto } from "@/lib/logisticaApi";
import {
  Siren,
  MapPin,
  Car,
  AlertTriangle,
  Loader2,
  Zap,
} from "lucide-react";

export function DespachoEmergencialDialog({
  aberto,
  osId,
  onFechar,
  onDespachado,
}: {
  aberto: boolean;
  osId: string | null;
  onFechar: () => void;
  onDespachado: () => void;
}) {
  const { toast } = useToast();
  const [carregando, setCarregando] = useState(false);
  const [despachandoId, setDespachandoId] = useState<string | null>(null);
  const [dados, setDados] = useState<ProximidadeTecnicosDto | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || !osId) return;

    let ativo = true;
    setCarregando(true);
    setErro(null);

    logisticaApi
      .obterTecnicosProximos(osId)
      .then((res) => {
        if (ativo) setDados(res);
      })
      .catch((err) => {
        if (ativo) setErro(err?.message ?? "Falha ao buscar técnicos próximos.");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [aberto, osId]);

  async function despachar(tecnicoId: string, nomeTecnico: string) {
    if (!osId) return;

    setDespachandoId(tecnicoId);
    try {
      const res = await logisticaApi.despacharEmergencial(osId, {
        tecnicoId,
        encaixarPrimeiro: true,
      });

      toast({
        variante: "sucesso",
        titulo: "🚨 Despacho Emergencial Concluído!",
        descricao: res.mensagem || `OS atribuída com sucesso para ${nomeTecnico} como 1ª parada prioritária.`,
      });

      onDespachado();
      onFechar();
    } catch (err: unknown) {
      toast({
        variante: "erro",
        titulo: "Falha no despacho",
        descricao: err instanceof Error ? err.message : "Não foi possível despachar a OS.",
      });
    } finally {
      setDespachandoId(null);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg overflow-hidden sm:max-w-xl">
        <DialogHeader className="border-b border-border pb-3">
          <div className="flex items-center gap-2 text-destructive">
            <Siren className="size-5 animate-pulse" />
            <DialogTitle className="text-lg font-bold">
              Despacho Emergencial por Proximidade
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Localize e atribua a O.S. ao técnico mais próximo em tempo real com prioridade imediata.
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="size-8 animate-spin text-destructive" />
            <p className="text-sm font-medium text-muted-foreground">
              Calculando técnicos mais próximos do local da emergência...
            </p>
          </div>
        ) : erro ? (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="size-5 shrink-0" />
            <p>{erro}</p>
          </div>
        ) : dados ? (
          <div className="space-y-4 py-2">
            {/* Detalhes da OS Urgente */}
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm text-foreground">
                  {dados.os.clienteNome ?? "Cliente não identificado"}
                </span>
                <span className="rounded bg-destructive/20 px-2 py-0.5 text-xs font-bold text-destructive">
                  OS #{dados.os.sgpOsId}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="size-3.5 text-destructive shrink-0" />
                <span>
                  {dados.os.bairro ? `${dados.os.bairro}, ` : ""}
                  {dados.os.cidade ?? "Cidade não informada"}
                </span>
                {dados.os.tipoOs && (
                  <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                    {dados.os.tipoOs}
                  </span>
                )}
              </div>
            </div>

            {dados.semCoordenada && (
              <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  Esta OS ainda não possui latitude e longitude registradas. A ordenação padrão de técnicos foi mantida.
                </span>
              </div>
            )}

            {/* Lista dos Técnicos mais próximos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Técnicos em Campo ({dados.tecnicos.length})
                </span>
                <span className="text-[11px] text-muted-foreground">ordenado por menor distância</span>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {dados.tecnicos.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    Nenhum técnico ativo no momento.
                  </p>
                ) : (
                  dados.tecnicos.map((t, index) => {
                    const despachando = despachandoId === t.id;
                    const maisProximo = index === 0 && t.distanciaKm != null;

                    return (
                      <div
                        key={t.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 text-xs transition-colors hover:bg-secondary/40 ${
                          maisProximo ? "bg-emerald-500/5 dark:bg-emerald-500/10" : ""
                        }`}
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground text-sm truncate">
                              {t.nome}
                            </span>
                            {maisProximo && (
                              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                                Mais próximo
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-[11px]">
                            {t.distanciaKm != null ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                                <MapPin className="size-3 text-destructive" />
                                {t.distanciaKm} km
                                {t.minutosEstimados != null && (
                                  <span className="text-muted-foreground font-normal">
                                    (~{t.minutosEstimados} min)
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Local sem GPS</span>
                            )}

                            {t.veiculo && (
                              <span className="inline-flex items-center gap-1">
                                <Car className="size-3 text-primary" />
                                {t.veiculo.rotulo}
                              </span>
                            )}

                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                t.status === "disponivel"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : t.status === "em_deslocamento"
                                    ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              }`}
                            >
                              {t.statusRotulo}
                            </span>

                            <span>{t.paradasHoje} paradas hoje</span>
                          </div>
                        </div>

                        <div className="shrink-0 pt-1 sm:pt-0">
                          <Button
                            size="sm"
                            variant={maisProximo ? "default" : "outline"}
                            disabled={despachandoId !== null}
                            onClick={() => void despachar(t.id, t.nome)}
                            className="w-full sm:w-auto gap-1.5 text-xs h-8 font-semibold"
                          >
                            {despachando ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Zap className="size-3.5 text-amber-400" />
                            )}
                            Despachar Urgente
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={onFechar} disabled={despachandoId !== null}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
