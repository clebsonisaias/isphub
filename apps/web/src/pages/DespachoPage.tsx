import { lazy, Suspense, useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Map as MapIcon, Search, Users, Zap, Siren, Bot, Loader2 } from "lucide-react";
import { OsStatus, ROTULO_TURNO, TURNOS_AGENDA, diaBrHoje, somarDias, type FilaItem, type SlaSemaforo, type TurnoAgenda, type VagaTurno } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { OrdemServicoDetailDialog } from "@/components/OrdemServicoDetailDialog";
import { useToast } from "@/context/ToastContext";
import { agendaApi, rotuloDiaAgenda } from "@/lib/agendaApi";
import { fechadoNoCalendario, textoBloqueio } from "@/lib/agendaUi";
import { escalaApi } from "@/lib/escalaApi";
import { filaApi, ordensServicoApi, tecnicosApi } from "@/lib/filaApi";
import { ApiError } from "@/lib/apiClient";
import { acaoDoDrop, montarQuadro, paraAgendar, paradaDe, type Arrasto, type Destino, type Parada } from "@/lib/despacho";
import { useRealtime } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { OtimizarRotaDialog } from "@/components/despacho/OtimizarRotaDialog";
import { DespachoEmergencialDialog } from "@/components/despacho/DespachoEmergencialDialog";
import { logisticaApi } from "@/lib/logisticaApi";

const MapaDoDia = lazy(() => import("@/components/despacho/MapaDoDia"));

/**
 * DESPACHO — a mesa do supervisor: o que falta agendar à esquerda, o Quadro do
 * dia ao centro (uma linha por técnico, paradas da manhã e da tarde na ordem
 * da rota) e o mapa com as viaturas sob demanda. Juntou o que antes exigia
 * alternar entre Painel, Agenda e Mapa.
 *
 * Arrastar é o atalho; tudo também se faz pela OS (clique abre o detalhe, com
 * marcar visita e atribuir técnico), que é o caminho de teclado e de celular.
 */

const PAGINA = 40;
const ANEL: Partial<Record<SlaSemaforo, string>> = {
  vermelho: "ring-2 ring-destructive ring-offset-2 ring-offset-card",
  amarelo: "ring-2 ring-warning ring-offset-2 ring-offset-card",
};
const TEXTO_PRAZO: Partial<Record<SlaSemaforo, string>> = { vermelho: "text-destructive font-semibold", amarelo: "text-warning font-semibold" };

function mensagem(err: unknown) {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

function prazoDe(i: FilaItem): string {
  const min = i.sla.minutosRestantes;
  if (min == null) return i.dataCadastro ? `Aberta em ${new Date(i.dataCadastro).toLocaleDateString("pt-BR")}` : "Sem prazo";
  const horas = Math.round(Math.abs(min) / 60);
  const quanto = horas < 1 ? `${Math.abs(min)} min` : horas < 48 ? `${horas} h` : `${Math.round(horas / 24)} dias`;
  return min < 0 ? `Prazo estourado há ${quanto}` : `Prazo em ${quanto}`;
}

export function DespachoPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const hoje = diaBrHoje();
  const [dia, setDia] = useState(hoje);
  const [todos, setTodos] = useState(false);
  const [mapaAberto, setMapaAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(PAGINA);
  const [arrastando, setArrastando] = useState<Arrasto | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [selecionado, setSelecionado] = useState<FilaItem | null>(null);
  const [otimizarTecnico, setOtimizarTecnico] = useState<{ id: string; nome: string } | null>(null);
  const [emergencialOsId, setEmergencialOsId] = useState<string | null>(null);
  const [roteirizandoRobo, setRoteirizandoRobo] = useState(false);

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => somarDias(hoje, i)), [hoje]);
  const grade = useQuery({
    queryKey: ["agenda", "grade", "despacho", hoje],
    queryFn: () => agendaApi.grade({ de: hoje, ate: somarDias(hoje, 6), equipe: "interna" }),
  });
  const manha = useQuery({
    queryKey: ["agenda", "turno", dia, "manha", "interna"],
    queryFn: () => agendaApi.doTurno(dia, "manha", { equipe: "interna" }),
  });
  const tarde = useQuery({
    queryKey: ["agenda", "turno", dia, "tarde", "interna"],
    queryFn: () => agendaApi.doTurno(dia, "tarde", { equipe: "interna" }),
  });
  const fila = useQuery({
    queryKey: ["fila", { grupo: "abertos", equipe: "interna", despacho: true }],
    queryFn: () => filaApi.listar({ grupo: "abertos", equipe: "interna" }),
  });
  const tecnicos = useQuery({ queryKey: ["tecnicos"], queryFn: () => tecnicosApi.listar(), staleTime: 5 * 60_000 });
  const escala = useQuery({ queryKey: ["escala", dia], queryFn: () => escalaApi.doDia(dia) });

  const vagaDe = useMemo(() => {
    const m = new Map<string, VagaTurno>();
    for (const v of grade.data?.vagas ?? []) m.set(`${v.dia}|${v.turno}`, v);
    return m;
  }, [grade.data]);

  const filaPorId = useMemo(() => new Map((fila.data?.itens ?? []).map((i) => [i.id, i])), [fila.data]);

  const paradas = useMemo(() => {
    const sla = new Map([...filaPorId].map(([id, i]) => [id, i.sla.semaforo]));
    const todas = [
      ...(manha.data ?? []).map((p) => paradaDe(p, "manha", sla)),
      ...(tarde.data ?? []).map((p) => paradaDe(p, "tarde", sla)),
    ];
    // No despacho não aparecem retiradas: retiradas têm a aba própria (/retiradas)
    return todas.filter(
      (p) => !p.equipeExterna && p.fila !== "retirada" && !p.categoria.toLowerCase().includes("retirada"),
    );
  }, [manha.data, tarde.data, filaPorId]);

  const linhas = useMemo(() => {
    const escalados = new Set((escala.data ?? []).filter((e) => !e.ausenteEm).map((e) => e.usuarioId));
    return montarQuadro(paradas, tecnicos.data ?? [], escalados, todos);
  }, [paradas, tecnicos.data, escala.data, todos]);

  const pendentes = useMemo(() => {
    const abertos = paraAgendar(fila.data?.itens ?? []);
    // Garantia defensiva extra: remove qualquer retirada que venha da fila
    return abertos.filter(
      (i) => !i.categoria?.equipeExterna && !i.categoria?.nome?.toLowerCase().includes("retirada"),
    );
  }, [fila.data]);
  const categorias = useMemo(() => {
    const m = new Map<string, { nome: string; cor: string; n: number }>();
    for (const i of pendentes) {
      const nome = i.categoria?.nome ?? "Sem categoria";
      const atual = m.get(nome) ?? { nome, cor: i.categoria?.cor ?? "#64748b", n: 0 };
      atual.n++;
      m.set(nome, atual);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [pendentes]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pendentes.filter(
      (i) =>
        (!categoria || (i.categoria?.nome ?? "Sem categoria") === categoria) &&
        (!q ||
          [i.clienteNome, i.sgpOsId, i.endereco?.bairro, i.pop, i.contratoId, i.protocolo].some((c) => c?.toLowerCase().includes(q))),
    );
  }, [pendentes, busca, categoria]);

  /** Bloqueio de calendário do turno (feriado, sábado à tarde...) ou dia que já passou. Lotação o servidor decide. */
  function turnoFechado(t: TurnoAgenda): string | null {
    if (dia < hoje) return "Esse dia já passou.";
    const v = vagaDe.get(`${dia}|${t}`);
    return v && fechadoNoCalendario(v) ? textoBloqueio(v) : null;
  }

  async function abrirOs(osId: string) {
    try {
      setSelecionado(filaPorId.get(osId) ?? (await ordensServicoApi.obter(osId)));
    } catch (e) {
      toast({ variante: "erro", titulo: "Não foi possível abrir a OS", descricao: mensagem(e) });
    }
  }

  function atualizar() {
    void queryClient.invalidateQueries({ queryKey: ["agenda"] });
    void queryClient.invalidateQueries({ queryKey: ["fila"] });
  }

  // OS mudou noutro lugar (fechou no SGP, encerrada noutra tela): recarrega na hora,
  // juntando rajadas em 800 ms como o Painel (ver FilaWorkspace).
  const recarga = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime((evento) => {
    if (evento.tipo !== "os-alterada") return;
    if (recarga.current) clearTimeout(recarga.current);
    recarga.current = setTimeout(atualizar, 800);
  });

  async function soltar(a: Arrasto, d: Destino) {
    const acao = acaoDoDrop(a, d, turnoFechado);
    if (acao.tipo === "nada") return;
    if (acao.tipo === "recusar") {
      toast({ variante: "erro", titulo: "Não dá para mover", descricao: acao.motivo });
      return;
    }
    const sgpOsId = a.tipo === "nova" ? a.item.sgpOsId : a.parada.sgpOsId;
    const tecnico = acao.atribuir ? (tecnicos.data ?? []).find((t) => t.id === acao.atribuir)?.nome : null;
    setSalvando(true);
    try {
      if (acao.marcarTurno) {
        await agendaApi.marcar(
          a.tipo === "nova"
            ? { provedorId: a.item.provedorId, sgpOsId, dia, turno: acao.marcarTurno, regiao: a.item.pop ?? a.item.endereco?.bairro ?? null }
            : { provedorId: a.parada.provedorId, sgpOsId, dia, turno: acao.marcarTurno, regiao: a.parada.regiao },
        );
      }
      if (acao.atribuir) {
        await ordensServicoApi.atribuir(a.tipo === "nova" ? a.item.id : a.parada.osId!, acao.atribuir);
      }
      const onde = acao.marcarTurno ? `${rotuloDiaAgenda(dia)}, ${ROTULO_TURNO[acao.marcarTurno].toLowerCase()}` : null;
      toast({
        variante: "sucesso",
        titulo: a.tipo === "nova" ? "Visita marcada" : acao.marcarTurno ? "Visita remarcada" : "Técnico atribuído",
        descricao: [`OS ${sgpOsId}`, onde, tecnico ? `com ${tecnico}` : null].filter(Boolean).join(", "),
      });
    } catch (e) {
      // 409 chega com o motivo do servidor ("Turno lotado", "Limite da região"...).
      toast({ variante: "erro", titulo: "Não deu para mover", descricao: mensagem(e) });
    } finally {
      setSalvando(false);
      atualizar();
    }
  }

  const arrastar = (a: Arrasto) => (e: DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", a.tipo === "nova" ? a.item.sgpOsId : a.parada.sgpOsId);
    setArrastando(a);
  };
  const fimDoArrasto = () => {
    setArrastando(null);
    setAlvo(null);
  };
  const alvoDe = (d: Destino) => ({
    onDragOver: (e: DragEvent) => {
      if (!arrastando) return;
      e.preventDefault();
      setAlvo(`${d.tecnicoId ?? "-"}|${d.turno}`);
    },
    onDragLeave: () => setAlvo((atual) => (atual === `${d.tecnicoId ?? "-"}|${d.turno}` ? null : atual)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const a = arrastando;
      fimDoArrasto();
      if (a) void soltar(a, d);
    },
  });

  const handleRoboRoteirizar = async () => {
    setRoteirizandoRobo(true);
    try {
      const res = await logisticaApi.roboOtimizarDia(dia);
      toast({
        titulo: "Robô de Roteirização Concluído",
        descricao: `${res.tecnicosOtimizados} técnicos organizados na melhor sequência. Economia estimada: -${res.kmTotalEconomizado} km!`,
        variante: "info",
      });
      void queryClient.invalidateQueries({ queryKey: ["agenda", "turno", dia] });
    } catch (e) {
      toast({
        titulo: "Falha na Roteirização",
        descricao: e instanceof Error ? e.message : "Erro ao executar o robô",
        variante: "erro",
      });
    } finally {
      setRoteirizandoRobo(false);
    }
  };

  const carregandoQuadro = manha.isPending || tarde.isPending || tecnicos.isPending;

  return (
    <AppShell>
      <AnimatedPage>
        <div className="flex flex-col gap-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Despacho</h1>
              <p className="text-sm text-muted-foreground">
                Arraste uma OS para o turno e o técnico. Clique para abrir a OS.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void handleRoboRoteirizar()}
                disabled={roteirizandoRobo}
                title="Otimiza automaticamente as rotas de todos os técnicos do dia pelo menor percurso com custo zero de IA"
                className="gap-2 font-semibold"
              >
                {roteirizandoRobo ? <Loader2 className="size-4 animate-spin text-primary" /> : <Bot className="size-4 text-primary" />}
                Robô: Roteirizar Todos
              </Button>
              <Button variant={mapaAberto ? "default" : "outline"} onClick={() => setMapaAberto((v) => !v)} aria-pressed={mapaAberto}>
                <MapIcon className="size-4" aria-hidden />
                {mapaAberto ? "Esconder mapa" : "Ver no mapa"}
              </Button>
            </div>
          </header>

          <div role="tablist" aria-label="Dia" className="flex gap-1.5 overflow-x-auto pb-1">
            {dias.map((d, i) => {
              const vagas = TURNOS_AGENDA.map((t) => vagaDe.get(`${d}|${t}`)).filter((v): v is VagaTurno => !!v);
              const abertas = vagas.filter((v) => !fechadoNoCalendario(v));
              const ocupadas = vagas.reduce((s, v) => s + v.ocupadas, 0);
              const capacidade = abertas.reduce((s, v) => s + v.capacidade, 0);
              const ativo = d === dia;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={ativo}
                  onClick={() => setDia(d)}
                  className={cn(
                    "flex min-w-[6.5rem] flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors",
                    ativo ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-secondary",
                  )}
                >
                  <span className="text-sm font-semibold">{i === 0 ? "Hoje" : i === 1 ? "Amanhã" : rotuloDiaAgenda(d)}</span>
                  <span className="text-xs tabular-nums opacity-80">
                    {vagas.length === 0 ? "…" : abertas.length === 0 ? "Fechado" : `${ocupadas} de ${capacidade}`}
                  </span>
                </button>
              );
            })}
          </div>

          {mapaAberto ? (
            <Suspense fallback={<Skeleton className="h-[380px] w-full rounded-lg" />}>
              <MapaDoDia paradas={paradas} aoAbrirOs={(id) => void abrirOs(id)} />
            </Suspense>
          ) : null}

          <div className="flex flex-wrap items-start gap-4">
            {/* ---- Para agendar ---- */}
            <section
              aria-labelledby="para-agendar"
              className="flex min-w-0 flex-[1_1_18rem] flex-col rounded-lg border border-border bg-card lg:max-w-[21rem]"
            >
              <div className="flex flex-col gap-3 border-b border-border p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 id="para-agendar" className="text-lg font-bold">Para agendar</h2>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {fila.isPending ? "…" : `${pendentes.length.toLocaleString("pt-BR")} sem visita`}
                  </span>
                </div>
                <label className="relative block">
                  <span className="sr-only">Buscar OS sem visita</span>
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, bairro ou nº da OS" className="pl-8" />
                </label>
                {categorias.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      aria-pressed={categoria === null}
                      onClick={() => setCategoria(null)}
                      className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", categoria === null ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary")}
                    >
                      Todas
                    </button>
                    {categorias.map((c) => (
                      <button
                        key={c.nome}
                        type="button"
                        aria-pressed={categoria === c.nome}
                        onClick={() => setCategoria(categoria === c.nome ? null : c.nome)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                          categoria === c.nome ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary",
                        )}
                      >
                        <span className="size-2 rounded-full" style={{ background: c.cor }} aria-hidden />
                        {c.nome} <span className="tabular-nums opacity-80">{c.n.toLocaleString("pt-BR")}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {fila.data?.truncado ? (
                  <p className="text-xs text-warning">A lista passou do limite do servidor; use a busca para achar o resto.</p>
                ) : null}
              </div>

              {fila.isPending ? (
                <div className="flex flex-col gap-2 p-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : visiveis.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  {busca || categoria ? "Nenhuma OS sem visita com esse filtro." : "Todas as OS abertas já têm visita."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {visiveis.slice(0, mostrar).map((i) => (
                    <li key={i.id} className="group relative flex items-center hover:bg-secondary/40 transition-colors">
                      <button
                        type="button"
                        draggable
                        onDragStart={arrastar({ tipo: "nova", item: i })}
                        onDragEnd={fimDoArrasto}
                        onClick={() => setSelecionado(i)}
                        className={cn(
                          "flex min-w-0 flex-1 cursor-grab gap-3 px-4 py-3 text-left active:cursor-grabbing",
                          arrastando?.tipo === "nova" && arrastando.item.id === i.id && "opacity-40",
                        )}
                      >
                        <span className="w-1 shrink-0 self-stretch rounded-full" style={{ background: i.categoria?.cor ?? "#64748b" }} aria-hidden />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex justify-between gap-2">
                            <span className="truncate font-semibold">{i.clienteNome ?? "Cliente não identificado"}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{i.sgpOsId}</span>
                          </span>
                          <span className="truncate text-sm text-muted-foreground">
                            {i.categoria?.nome ?? "Sem categoria"}
                            {i.endereco?.bairro || i.pop ? `, ${i.endereco?.bairro ?? i.pop}` : ""}
                          </span>
                          <span className={cn("text-xs tabular-nums text-muted-foreground", TEXTO_PRAZO[i.sla.semaforo])}>{prazoDe(i)}</span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setEmergencialOsId(i.id)}
                        className="mr-3 opacity-0 group-hover:opacity-100 focus:opacity-100 rounded-lg border border-destructive/30 bg-destructive/10 p-1.5 text-destructive hover:bg-destructive hover:text-white transition-all shadow-xs"
                        title="Despacho emergencial por proximidade física"
                      >
                        <Siren className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {visiveis.length > mostrar ? (
                <Button variant="ghost" className="m-2" onClick={() => setMostrar((n) => n + PAGINA)}>
                  Mostrar mais {Math.min(PAGINA, visiveis.length - mostrar)}
                </Button>
              ) : null}
            </section>

            {/* ---- Quadro do dia ---- */}
            <section aria-labelledby="quadro" className="flex min-w-0 flex-[999_1_34rem] flex-col rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h2 id="quadro" className="text-lg font-bold">
                  Quadro de {dia === hoje ? "hoje" : rotuloDiaAgenda(dia)}
                  {salvando ? <span className="ml-2 text-xs font-normal text-muted-foreground">salvando…</span> : null}
                </h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full ring-2 ring-destructive ring-offset-1 ring-offset-card" aria-hidden />
                    Prazo estourado
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full ring-2 ring-warning ring-offset-1 ring-offset-card" aria-hidden />
                    Prazo vencendo
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setTodos((v) => !v)} aria-pressed={todos}>
                  <Users className="size-4" aria-hidden />
                  {todos ? "Só quem trabalha no dia" : "Mostrar todos os técnicos"}
                </Button>
              </div>

              <div className="overflow-x-auto">
                <div className="grid min-w-[48rem] grid-cols-[11rem_minmax(18rem,1fr)_minmax(18rem,1fr)]">
                  <div className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">Técnico</div>
                  {TURNOS_AGENDA.map((t) => {
                    const v = vagaDe.get(`${dia}|${t}`);
                    const pct = v && v.capacidade > 0 ? Math.min(100, Math.round((v.ocupadas / v.capacidade) * 100)) : 0;
                    return (
                      <div key={t} className="flex items-center gap-3 border-b border-l border-border px-4 py-2.5">
                        <span className="font-bold">{ROTULO_TURNO[t]}</span>
                        {v ? (
                          fechadoNoCalendario(v) ? (
                            <span className="text-xs text-muted-foreground">{textoBloqueio(v)}</span>
                          ) : (
                            <>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {v.ocupadas} de {v.capacidade}
                              </span>
                              <span className="h-1.5 max-w-28 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden>
                                <span className="block h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
                              </span>
                            </>
                          )
                        ) : null}
                      </div>
                    );
                  })}

                  {carregandoQuadro
                    ? [0, 1, 2].map((i) => (
                        <div key={i} className="col-span-3 border-b border-border p-4">
                          <Skeleton className="h-12 w-full" />
                        </div>
                      ))
                    : linhas.map((l) => (
                        <LinhaDoQuadro
                          key={l.tecnicoId ?? "sem-tecnico"}
                          linha={l}
                          alvo={alvo}
                          arrastando={arrastando}
                          fechado={turnoFechado}
                          alvoDe={alvoDe}
                          arrastar={arrastar}
                          fimDoArrasto={fimDoArrasto}
                          aoAbrir={(osId) => void abrirOs(osId)}
                          onOtimizar={(id, nome) => setOtimizarTecnico({ id, nome })}
                        />
                      ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </AnimatedPage>

      {selecionado ? (
        <OrdemServicoDetailDialog
          key={selecionado.id}
          item={selecionado}
          onClose={() => setSelecionado(null)}
          onAtualizado={() => {
            setSelecionado(null);
            atualizar();
          }}
        />
      ) : null}

      {otimizarTecnico ? (
        <OtimizarRotaDialog
          aberto={otimizarTecnico !== null}
          tecnicoId={otimizarTecnico.id}
          tecnicoNome={otimizarTecnico.nome}
          dia={dia}
          onFechar={() => setOtimizarTecnico(null)}
          onAplicado={() => {
            setOtimizarTecnico(null);
            atualizar();
          }}
        />
      ) : null}

      {emergencialOsId ? (
        <DespachoEmergencialDialog
          aberto={emergencialOsId !== null}
          osId={emergencialOsId}
          onFechar={() => setEmergencialOsId(null)}
          onDespachado={() => {
            setEmergencialOsId(null);
            atualizar();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function LinhaDoQuadro({
  linha,
  alvo,
  arrastando,
  fechado,
  alvoDe,
  arrastar,
  fimDoArrasto,
  aoAbrir,
  onOtimizar,
}: {
  linha: ReturnType<typeof montarQuadro>[number];
  alvo: string | null;
  arrastando: Arrasto | null;
  fechado: (t: TurnoAgenda) => string | null;
  alvoDe: (d: Destino) => { onDragOver: (e: DragEvent) => void; onDragLeave: () => void; onDrop: (e: DragEvent) => void };
  arrastar: (a: Arrasto) => (e: DragEvent) => void;
  fimDoArrasto: () => void;
  aoAbrir: (osId: string) => void;
  onOtimizar: (tecnicoId: string, nome: string) => void;
}) {
  const semTecnico = linha.tecnicoId === null;
  const total = linha.manha.length + linha.tarde.length;
  return (
    <>
      <div className={cn("flex flex-col justify-center gap-0.5 border-b border-border px-4 py-3", semTecnico && "bg-warning/10")}>
        <div className="flex items-center justify-between gap-1">
          <span className={cn("font-bold", semTecnico && "text-warning")}>{linha.nome}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {semTecnico
            ? "Arraste para um técnico"
            : linha.apoio.length > 0
              ? `com ${linha.apoio.join(", ")}`
              : total === 0
                ? "Sem paradas"
                : `${total} parada${total === 1 ? "" : "s"}`}
        </span>
        {!semTecnico && total >= 2 && (
          <button
            type="button"
            onClick={() => onOtimizar(linha.tecnicoId!, linha.nome)}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition-colors min-h-9 shadow-2xs w-fit"
            title="Otimizar sequência das paradas para menor quilometragem e combustível"
          >
            <Zap className="size-3.5 text-amber-500" />
            Otimizar Rota
          </button>
        )}
      </div>
      {TURNOS_AGENDA.map((t) => {
        const lista = t === "manha" ? linha.manha : linha.tarde;
        const chave = `${linha.tecnicoId ?? "-"}|${t}`;
        const destacado = alvo === chave && arrastando !== null;
        const bloqueio = fechado(t);
        return (
          <div
            key={t}
            {...alvoDe({ tecnicoId: linha.tecnicoId, turno: t })}
            className={cn(
              "relative min-h-[5.5rem] border-b border-l border-border px-4 pb-3 pt-3.5 transition-colors",
              semTecnico && "bg-warning/10",
              destacado && (bloqueio ? "bg-destructive/10" : "bg-primary/10 ring-2 ring-inset ring-primary/40"),
            )}
          >
            {lista.length === 0 ? (
              <span className="flex h-full min-h-[3.5rem] items-center text-xs text-muted-foreground/70">
                {bloqueio && arrastando ? bloqueio : arrastando ? "Solte aqui" : ""}
              </span>
            ) : (
              <ol className="flex flex-wrap gap-x-2 gap-y-3">
                {lista.map((p, i) => (
                  <li key={p.id} className="relative w-[4.75rem]">
                    {/* O fio da rota: do centro desta parada ao centro da próxima. */}
                    {!semTecnico && i < lista.length - 1 ? (
                      <span className="absolute left-1/2 top-4 h-0.5 w-[calc(100%+0.5rem)] bg-border" aria-hidden />
                    ) : null}
                    <ParadaNo
                      parada={p}
                      ordem={semTecnico ? null : i + 1}
                      arrastando={arrastando?.tipo === "parada" && arrastando.parada.id === p.id}
                      onDragStart={arrastar({ tipo: "parada", parada: p })}
                      onDragEnd={fimDoArrasto}
                      aoAbrir={aoAbrir}
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </>
  );
}

function ParadaNo({
  parada: p,
  ordem,
  arrastando,
  onDragStart,
  onDragEnd,
  aoAbrir,
}: {
  parada: Parada;
  ordem: number | null;
  arrastando: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  aoAbrir: (osId: string) => void;
}) {
  const encerrada = p.status === OsStatus.CONCLUIDA || p.status === OsStatus.CANCELADA;
  const rotulo = [
    p.cliente ?? `OS ${p.sgpOsId}`,
    p.categoria,
    p.local,
    encerrada ? (p.status === OsStatus.CONCLUIDA ? "concluída" : "cancelada") : null,
    p.sla === "vermelho" ? "prazo estourado" : p.sla === "amarelo" ? "prazo vencendo" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      draggable={!encerrada}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => p.osId && aoAbrir(p.osId)}
      title={rotulo}
      aria-label={rotulo}
      className={cn(
        "relative flex w-full flex-col items-center gap-1 rounded-md text-center",
        !encerrada && "cursor-grab active:cursor-grabbing",
        arrastando && "opacity-40",
      )}
    >
      <div className="relative">
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-full text-sm font-bold tabular-nums text-white shadow-sm",
            ANEL[p.sla ?? "sem_sla"],
            encerrada && "opacity-45",
          )}
          style={{ background: p.cor }}
        >
          {p.status === OsStatus.CONCLUIDA ? <Check className="size-4" aria-hidden /> : ordem}
        </span>
        {p.confirmadoEm ? (
          <span
            className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white shadow-xs"
            title="Confirmado pelo cliente via WhatsApp"
          >
            ✓
          </span>
        ) : p.solicitouReagendamento ? (
          <span
            className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[10px] text-white shadow-xs font-bold"
            title="Cliente solicitou reagendamento pelo WhatsApp"
          >
            !
          </span>
        ) : null}
      </div>
      <span className="line-clamp-2 text-xs font-semibold leading-tight">{p.local ?? "Sem local"}</span>
      <span className="text-[11px] tabular-nums text-muted-foreground">{p.sgpOsId}</span>
    </button>
  );
}
