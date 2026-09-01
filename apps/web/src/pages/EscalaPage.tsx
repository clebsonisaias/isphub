import { useCallback, useEffect, useMemo, useState } from "react";
import { Truck, Users, UserX } from "lucide-react";
import { PAPEIS_OCUPACAO, type PapelOcupacao } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/context/ToastContext";
import { tecnicosApi, type TecnicoResumo } from "@/lib/filaApi";
import { veiculosApi, type VeiculoFrota } from "@/lib/veiculosApi";
import { diaISO, escalaApi, type LinhaEscala } from "@/lib/escalaApi";

/**
 * A ESCALA DO DIA — quem vai em qual viatura, com quem.
 *
 * Existe porque a decisão da viatura passou a ser da supervisão. Sem esta
 * tela a regra nova não teria como ser exercida: o técnico perderia a escolha
 * e ninguém a ganharia.
 *
 * Uma linha por técnico, sempre — inclusive quem não foi escalado. Uma tela que
 * mostrasse só os escalados esconderia exatamente o que o supervisor precisa
 * ver antes das 7h: quem ainda está sem carro.
 */
export function EscalaPage() {
  const { toast } = useToast();
  const [dia, setDia] = useState(() => diaISO(new Date()));
  const [tecnicos, setTecnicos] = useState<TecnicoResumo[]>([]);
  const [veiculos, setVeiculos] = useState<VeiculoFrota[]>([]);
  const [escala, setEscala] = useState<LinhaEscala[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [t, v, e] = await Promise.all([tecnicosApi.listar(), veiculosApi.listar(), escalaApi.doDia(dia)]);
      setTecnicos(t);
      setVeiculos(v.filter((x) => x.status !== "inativo"));
      setEscala(e);
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível carregar a escala." });
    } finally {
      setCarregando(false);
    }
  }, [dia, toast]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const porUsuario = useMemo(() => new Map(escala.map((e) => [e.usuarioId, e])), [escala]);

  /** Quem mais vai no mesmo carro — derivado, não guardado (ver escalaService). */
  const parceirosDe = useCallback(
    (usuarioId: string, veiculoId: string | null) =>
      veiculoId
        ? escala.filter((e) => e.veiculoId === veiculoId && e.usuarioId !== usuarioId).map((e) => e.nome)
        : [],
    [escala],
  );

  async function mudar(usuarioId: string, veiculoId: string | null, papel: PapelOcupacao) {
    setSalvando(usuarioId);
    try {
      setEscala(await escalaApi.escalar({ usuarioId, dia, veiculoId, papel }));
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível salvar a escala." });
    } finally {
      setSalvando(null);
    }
  }

  async function remover(usuarioId: string) {
    setSalvando(usuarioId);
    try {
      setEscala(await escalaApi.desescalar(usuarioId, dia));
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível remover da escala." });
    } finally {
      setSalvando(null);
    }
  }

  return (
    <AppShell>
      <AnimatedPage>
        <div className="flex flex-col gap-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">Escala do dia</h1>
              <p className="text-sm text-muted-foreground">
                Quem vai em qual viatura. O app do técnico mostra isso quando ele inicia a jornada.
              </p>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Dia
              <input
                type="date"
                value={dia}
                onChange={(ev) => setDia(ev.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
          </header>

          <Card>
            <CardContent className="p-0">
              {carregando ? (
                <div className="flex flex-col gap-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : tecnicos.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhum técnico cadastrado.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {tecnicos.map((t) => {
                    const e = porUsuario.get(t.id);
                    const parceiros = parceirosDe(t.id, e?.veiculoId ?? null);
                    const ocupado = salvando === t.id;
                    return (
                      <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{t.nome}</p>
                          {/*
                            Três estados, não dois: escalado com carro, escalado
                            A PÉ (decisão) e não escalado (ninguém decidiu). Achatar
                            os dois últimos esconderia quem ficou de fora.
                          */}
                          <p className="text-xs text-muted-foreground">
                            {!e ? (
                              "Sem escala para este dia"
                            ) : e.veiculoId ? (
                              parceiros.length > 0 ? (
                                <span className="inline-flex items-center gap-1">
                                  <Users className="size-3" aria-hidden />
                                  com {parceiros.join(", ")}
                                </span>
                              ) : (
                                "Vai sozinho"
                              )
                            ) : (
                              "A pé"
                            )}
                          </p>
                        </div>

                        <select
                          aria-label={`Viatura de ${t.nome}`}
                          disabled={ocupado}
                          value={e ? (e.veiculoId ?? "a-pe") : ""}
                          onChange={(ev) => {
                            const v = ev.target.value;
                            if (v === "") return void remover(t.id);
                            void mudar(t.id, v === "a-pe" ? null : v, e?.papel ?? "motorista");
                          }}
                          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        >
                          <option value="">Sem escala</option>
                          <option value="a-pe">A pé</option>
                          {veiculos.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.apelido ? `${v.apelido} · ${v.placa}` : v.placa}
                            </option>
                          ))}
                        </select>

                        {/* O papel só faz sentido quando há carro. */}
                        {e?.veiculoId ? (
                          <select
                            aria-label={`Papel de ${t.nome}`}
                            disabled={ocupado}
                            value={e.papel}
                            onChange={(ev) => void mudar(t.id, e.veiculoId, ev.target.value as PapelOcupacao)}
                            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          >
                            {PAPEIS_OCUPACAO.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        ) : null}

                        <span className="w-5 text-muted-foreground" aria-hidden>
                          {e?.veiculoId ? <Truck className="size-4" /> : e ? <UserX className="size-4" /> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </AnimatedPage>
    </AppShell>
  );
}
