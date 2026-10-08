import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarX2, Shuffle, Truck, Users, UserX } from "lucide-react";
import { PAPEIS_OCUPACAO, ROTULO_TURNO, TURNOS_AGENDA, type PapelOcupacao, type TurnoAgenda } from "@isphub/shared";
import { agendaApi, type PropostaRedistribuicao } from "@/lib/agendaApi";
import { Link } from "react-router-dom";
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
  // Redistribuicao de quem faltou: proposta por turno, editavel antes de aplicar.
  const [redistribuindo, setRedistribuindo] = useState<{ usuarioId: string; nome: string } | null>(null);
  const [propostas, setPropostas] = useState<Record<TurnoAgenda, PropostaRedistribuicao | null>>({ manha: null, tarde: null });
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [aplicando, setAplicando] = useState(false);

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

  async function mudar(usuarioId: string, veiculoId: string | null, papel: PapelOcupacao, turnos?: TurnoAgenda[]) {
    setSalvando(usuarioId);
    try {
      setEscala(await escalaApi.escalar({ usuarioId, dia, veiculoId, papel, turnos: turnos ?? porUsuario.get(usuarioId)?.turnos }));
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível salvar a escala." });
    } finally {
      setSalvando(null);
    }
  }

  /** Meio período: tira ou poe um turno; nunca deixa os dois de fora (isso e "sem escala"). */
  function alternarTurno(e: LinhaEscala, turno: TurnoAgenda) {
    const atuais = new Set(e.turnos);
    if (atuais.has(turno)) atuais.delete(turno);
    else atuais.add(turno);
    if (atuais.size === 0) return;
    void mudar(e.usuarioId, e.veiculoId, e.papel, TURNOS_AGENDA.filter((t) => atuais.has(t)));
  }

  async function falta(e: LinhaEscala, ausente: boolean) {
    setSalvando(e.usuarioId);
    try {
      setEscala(await escalaApi.ausencia(e.usuarioId, { dia, ausente }));
      if (ausente) await abrirRedistribuicao(e.usuarioId, e.nome);
      else if (redistribuindo?.usuarioId === e.usuarioId) setRedistribuindo(null);
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível registrar a falta." });
    } finally {
      setSalvando(null);
    }
  }

  async function abrirRedistribuicao(usuarioId: string, nome: string) {
    setRedistribuindo({ usuarioId, nome });
    try {
      const [manha, tarde] = await Promise.all(TURNOS_AGENDA.map((t) => agendaApi.redistribuicao(dia, t, usuarioId)));
      setPropostas({ manha, tarde });
      const iniciais: Record<string, string> = {};
      for (const p of [...manha.paradas, ...tarde.paradas]) if (p.tecnicoSugeridoId) iniciais[p.agendamentoId] = p.tecnicoSugeridoId;
      setEscolhas(iniciais);
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível montar a redistribuição." });
      setRedistribuindo(null);
    }
  }

  async function aplicarRedistribuicao() {
    const itens = Object.entries(escolhas).map(([agendamentoId, tecnicoId]) => ({ agendamentoId, tecnicoId }));
    if (itens.length === 0) return;
    setAplicando(true);
    try {
      const r = await agendaApi.redistribuir(itens);
      toast({ variante: "sucesso", titulo: "Paradas redistribuídas", descricao: `${r.aplicadas} ${r.aplicadas === 1 ? "parada trocou" : "paradas trocaram"} de técnico.` });
      setRedistribuindo(null);
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível aplicar." });
    } finally {
      setAplicando(false);
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

                        {e ? (
                          <div className="flex items-center gap-1" role="group" aria-label={`Turnos de ${t.nome}`}>
                            {TURNOS_AGENDA.map((turno) => {
                              const ligado = e.turnos.includes(turno);
                              return (
                                <button
                                  key={turno}
                                  type="button"
                                  disabled={ocupado || !!e.ausenteEm}
                                  aria-pressed={ligado}
                                  onClick={() => alternarTurno(e, turno)}
                                  className={`rounded-md border px-2 py-1 text-xs ${ligado ? "border-primary/40 bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-muted"} disabled:opacity-50`}
                                >
                                  {ROTULO_TURNO[turno]}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}

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

                        {e ? (
                          e.ausenteEm ? (
                            <span className="inline-flex items-center gap-1.5 text-xs">
                              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                                <CalendarX2 className="size-3" aria-hidden />
                                Faltou
                              </span>
                              <button type="button" disabled={ocupado} onClick={() => void falta(e, false)} className="text-muted-foreground underline-offset-2 hover:underline">
                                voltou
                              </button>
                              <button
                                type="button"
                                disabled={ocupado}
                                onClick={() => void abrirRedistribuicao(e.usuarioId, e.nome)}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-muted"
                              >
                                <Shuffle className="size-3" aria-hidden />
                                Redistribuir
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={ocupado}
                              onClick={() => void falta(e, true)}
                              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                            >
                              Faltou
                            </button>
                          )
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

          {redistribuindo ? (
            <Card>
              <CardContent className="flex flex-col gap-3 p-4">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <Shuffle className="size-4 text-muted-foreground" aria-hidden />
                      Paradas de {redistribuindo.nome} em {dia.split("-").reverse().slice(0, 2).join("/")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Sugestão por menor carga entre os escalados do turno. Troque quem quiser antes de aplicar; o que não couber vai para remarcação.
                    </p>
                  </div>
                  <button type="button" onClick={() => setRedistribuindo(null)} className="text-xs text-muted-foreground hover:text-foreground">
                    fechar
                  </button>
                </header>

                {TURNOS_AGENDA.map((turno) => {
                  const p = propostas[turno];
                  if (!p) return <Skeleton key={turno} className="h-10 w-full" />;
                  if (p.paradas.length === 0) return null;
                  return (
                    <div key={turno} className="flex flex-col gap-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {ROTULO_TURNO[turno]} · {p.paradas.length} {p.paradas.length === 1 ? "parada" : "paradas"}
                        {p.tetoPorTecnico != null ? ` · até ${p.tetoPorTecnico} por técnico` : ""}
                      </p>
                      <ul className="divide-y divide-border rounded-md border border-border">
                        {p.paradas.map((parada) => (
                          <li key={parada.agendamentoId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{parada.clienteNome ?? `OS ${parada.sgpOsId}`}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                OS #{parada.sgpOsId}
                                {parada.regiao ? ` · ${parada.regiao}` : ""}
                              </p>
                            </div>
                            <select
                              aria-label={`Quem assume ${parada.clienteNome ?? parada.sgpOsId}`}
                              value={escolhas[parada.agendamentoId] ?? ""}
                              onChange={(ev) =>
                                setEscolhas((atual) => {
                                  const prox = { ...atual };
                                  if (ev.target.value) prox[parada.agendamentoId] = ev.target.value;
                                  else delete prox[parada.agendamentoId];
                                  return prox;
                                })
                              }
                              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                            >
                              <option value="">Remarcar depois</option>
                              {p.candidatos.map((c) => (
                                <option key={c.tecnicoId} value={c.tecnicoId}>
                                  {c.nome} ({c.carga} no turno)
                                </option>
                              ))}
                            </select>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}

                {propostas.manha && propostas.tarde && propostas.manha.paradas.length + propostas.tarde.paradas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma parada marcada para essa pessoa neste dia.</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void aplicarRedistribuicao()}
                      disabled={aplicando || Object.keys(escolhas).length === 0}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {aplicando ? "Aplicando…" : `Aplicar ${Object.keys(escolhas).length} troca(s)`}
                    </button>
                    <Link to="/agenda" className="text-xs text-primary underline-offset-2 hover:underline">
                      Remarcar o que sobrou na agenda
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </AnimatedPage>
    </AppShell>
  );
}
