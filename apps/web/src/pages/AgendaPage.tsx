import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowDown, StickyNote, Wand2, ArrowUp, CalendarDays, CalendarOff, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, CloudOff, MapPin, Phone, RefreshCw, Route, Search, Settings2, Trash2, X } from "lucide-react";
import { ROTULO_TURNO, TURNOS_AGENDA, turnoDaHora, diaBrHoje, formatarKm, inicioDaSemana, somarDias, type AgendaConfigDto, type FilaItem, type ResultadoAuto, type TurnoAgenda, type VagaTurno } from "@isphub/shared";
import { observacaoVisivel, type SaudeAgendador } from "@/lib/agendaApi";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/context/ToastContext";
import { filaApi, ordensServicoApi, tecnicosApi, type TecnicoResumo } from "@/lib/filaApi";
import { Input } from "@/components/ui/input";
import { fechadoNoCalendario, textoBloqueio, tomDaVaga } from "@/lib/agendaUi";
import { ApiError } from "@/lib/apiClient";
import { agendaApi, rotuloDiaAgenda, type ExcecaoAgenda, type ParadaAgenda } from "@/lib/agendaApi";

/**
 * A AGENDA — a planilha de agendamento de OS, inteira, numa página.
 *
 * A planilha AVISAVA depois do fato ("Verificar concentração"), quando a
 * atendente já tinha combinado o horário com o cliente. Aqui o limite é
 * anterior à promessa: o turno cheio aparece cheio, e o que não cabe não é
 * ofertado em lugar nenhum do sistema.
 *
 * Duas metades, na ordem em que o supervisor pergunta: primeiro a GRADE (onde
 * ainda cabe), depois a ROTA de uma janela (em que ordem visitar). Separar as
 * duas em telas diferentes obrigaria a ir e voltar justamente enquanto ele
 * remaneja — que é o momento em que as duas perguntas são a mesma.
 */

const rotuloDia = rotuloDiaAgenda;

/** Os 7 dias (seg–dom) da semana que começa em `segunda`. Domingo entra cinza: o dia existe, só não atende. */
function diasDaSemana(segunda: string): string[] {
  return Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
}

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

export function AgendaPage() {
  const { toast } = useToast();
  const [janela, setJanela] = useState<{ dia: string; turno: TurnoAgenda } | null>(null);
  const [paradas, setParadas] = useState<ParadaAgenda[]>([]);
  const [carregandoParadas, setCarregandoParadas] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [editandoLimites, setEditandoLimites] = useState(false);
  const hoje = diaBrHoje();
  // A semana em tela, pela segunda-feira. Começa na de hoje; ‹ › andam de 7 em 7.
  const [semana, setSemana] = useState(() => inicioDaSemana(hoje));
  // Desmarcar em dois toques: o primeiro só pergunta. Um por vez.
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  // "Adicionar OS": o lote de OS abertas sem visita, carregado uma vez por painel.
  const [candidatas, setCandidatas] = useState<FilaItem[] | null>(null);
  const [buscaOs, setBuscaOs] = useState("");
  const [marcandoId, setMarcandoId] = useState<string | null>(null);
  // Sugestao de ordem por proximidade: calculada sob demanda, aplicada so no "Aplicar".
  const [sugestao, setSugestao] = useState<{ ordem: string[]; metros: number; metrosAtual: number; semCoordenada: number; comOrigem: boolean } | null>(null);
  const [sugerindo, setSugerindo] = useState(false);
  // Proposta automatica de dia/turno: so leitura, o supervisor revisa.
  const [proposta, setProposta] = useState<ResultadoAuto | null>(null);
  const [painelAberto, setPainelAberto] = useState(false);
  const [propondo, setPropondo] = useState(false);
  const [saude, setSaude] = useState<SaudeAgendador | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const queryClient = useQueryClient();
  const gradeQuery = useQuery({
    queryKey: ["agenda", "grade", semana],
    queryFn: () => agendaApi.grade({ de: semana, ate: somarDias(semana, 6) }),
    // Trocar de semana mantem a grade anterior ate a nova chegar.
    placeholderData: keepPreviousData,
  });
  const grade = gradeQuery.data ?? null;
  const carregando = gradeQuery.isPending;
  useEffect(() => {
    if (gradeQuery.error) toast({ variante: "erro", titulo: "Não foi possível carregar a agenda." });
  }, [gradeQuery.error, toast]);
  // Toda escrita (marcar, desmarcar, limites) chama isto: invalida TODAS as
  // semanas e turnos em cache (inclui a "Rota de agora"), e so o montado re-busca.
  const carregarGrade = useCallback(() => queryClient.invalidateQueries({ queryKey: ["agenda"] }), [queryClient]);
  const { data: tecnicos = [] } = useQuery<TecnicoResumo[]>({ queryKey: ["tecnicos"], queryFn: () => tecnicosApi.listar(), staleTime: 5 * 60_000 });

  const carregarParadas = useCallback(
    async (dia: string, turno: TurnoAgenda) => {
      setCarregandoParadas(true);
      try {
        setParadas(await agendaApi.doTurno(dia, turno));
      } catch {
        toast({ variante: "erro", titulo: "Não foi possível carregar as visitas do turno." });
      } finally {
        setCarregandoParadas(false);
      }
    },
    [toast],
  );

  // Fechar a gaveta re-busca a "Rota de agora": reordenar escreve só nas
  // paradas locais da gaveta, sem passar por carregarGrade.
  function fecharJanela() {
    setJanela(null);
    void queryClient.invalidateQueries({ queryKey: ["agenda", "turno"] });
  }

  function abrir(dia: string, turno: TurnoAgenda) {
    setJanela({ dia, turno });
    setConfirmandoId(null);
    setSugestao(null);
    void carregarParadas(dia, turno);
    // As candidatas valem pra qualquer janela; buscar uma vez por painel aberto.
    if (candidatas === null) {
      filaApi
        .listar({ grupo: "abertos", equipe: "interna" })
        .then((r) => setCandidatas(r.itens))
        .catch(() => setCandidatas([]));
    }
  }

  /** `vagas` por `dia|turno`, pra montar a grade seg–sáb × manhã/tarde. */
  const porJanela = useMemo(() => {
    const mapa = new Map<string, VagaTurno>();
    for (const v of grade?.vagas ?? []) mapa.set(`${v.dia}|${v.turno}`, v);
    return mapa;
  }, [grade]);
  const dias = diasDaSemana(semana);

  /** OS abertas ainda sem visita, filtradas pela busca — o que dá pra marcar neste turno. */
  const candidatasVisiveis = useMemo(() => {
    const q = buscaOs.trim().toLowerCase();
    return (candidatas ?? [])
      .filter((i) => !i.diaAgenda)
      .filter(
        (i) =>
          !q ||
          (i.clienteNome ?? "").toLowerCase().includes(q) ||
          (i.protocolo ?? "").toLowerCase().includes(q) ||
          (i.contratoId ?? "").toLowerCase().includes(q) ||
          i.sgpOsId.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [candidatas, buscaOs]);

  async function marcarNaJanela(item: FilaItem) {
    if (!janela) return;
    setMarcandoId(item.id);
    try {
      await agendaApi.marcar({
        provedorId: item.provedorId,
        sgpOsId: item.sgpOsId,
        dia: janela.dia,
        turno: janela.turno,
        regiao: item.pop ?? item.endereco?.bairro ?? null,
      });
      setCandidatas((atual) => atual?.map((c) => (c.id === item.id ? { ...c, diaAgenda: janela.dia, turnoAgenda: janela.turno } : c)) ?? null);
      await Promise.all([carregarParadas(janela.dia, janela.turno), carregarGrade()]);
      toast({ variante: "sucesso", titulo: "Visita marcada", descricao: `${item.clienteNome ?? `OS ${item.sgpOsId}`} · ${rotuloDia(janela.dia)}, ${ROTULO_TURNO[janela.turno]}` });
    } catch (e) {
      // 409 chega com o motivo do servidor ("Turno lotado", "Sábado só tem...").
      toast({ variante: "erro", titulo: "Não deu para marcar", descricao: mensagem(e) });
      void carregarGrade();
    } finally {
      setMarcandoId(null);
    }
  }

  /**
   * Move uma parada e grava a rota inteira.
   *
   * Otimista na tela e em lote no servidor: arrastar uma parada renumera todas,
   * e mandar uma requisição por posição deixaria a rota metade nova e metade
   * antiga se alguma falhasse no meio.
   */
  async function mover(indice: number, direcao: -1 | 1) {
    const alvo = indice + direcao;
    if (!janela || alvo < 0 || alvo >= paradas.length) return;
    const nova = [...paradas];
    [nova[indice], nova[alvo]] = [nova[alvo], nova[indice]];
    setParadas(nova);
    setSalvando(true);
    try {
      setParadas(await agendaApi.definirRota(janela.dia, janela.turno, nova.map((p) => p.id)));
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível salvar a rota." });
      void carregarParadas(janela.dia, janela.turno);
    } finally {
      setSalvando(false);
    }
  }

  async function sugerir() {
    if (!janela) return;
    setSugerindo(true);
    try {
      setSugestao(await agendaApi.sugestao(janela.dia, janela.turno));
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível calcular a sugestão." });
    } finally {
      setSugerindo(false);
    }
  }

  async function propor() {
    setPropondo(true);
    try {
      const [p, sd] = await Promise.all([agendaApi.propostaAuto(), agendaApi.saudeAuto().catch(() => null)]);
      setProposta(p);
      setSaude(sd);
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível calcular a proposta de agenda." });
    } finally {
      setPropondo(false);
    }
  }

  /** Grava as primeiras `n` propostas (um dia de trabalho) depois de o supervisor confirmar. */
  async function aplicarLote(n: number) {
    if (!proposta) return;
    const lote = proposta.propostas.slice(0, n);
    if (lote.length === 0 || !window.confirm(`Marcar ${lote.length} visitas na agenda? O técnico continua sendo escolhido por você.`)) return;
    setAplicando(true);
    try {
      const r = await agendaApi.aplicarAuto(lote);
      toast({
        variante: r.recusadas.length ? "info" : "sucesso",
        titulo: `${r.aplicadas.length} marcadas${r.recusadas.length ? `, ${r.recusadas.length} recusadas (a vaga mudou)` : ""}.`,
      });
      await carregarGrade();
      await propor();
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível aplicar o lote." });
    } finally {
      setAplicando(false);
    }
  }

  async function desfazerLote() {
    if (!window.confirm("Desfazer o que o agendador marcou hoje? Visitas que o cliente já confirmou ficam.")) return;
    setAplicando(true);
    try {
      const r = await agendaApi.desfazerAuto();
      toast({ variante: "sucesso", titulo: `${r.desfeitas} desfeitas${r.mantidasConfirmadas ? `, ${r.mantidasConfirmadas} mantidas (cliente confirmou)` : ""}.` });
      await carregarGrade();
      await propor();
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível desfazer o lote." });
    } finally {
      setAplicando(false);
    }
  }

  async function aplicarSugestao() {
    if (!janela || !sugestao) return;
    setSalvando(true);
    try {
      setParadas(await agendaApi.definirRota(janela.dia, janela.turno, sugestao.ordem));
      setSugestao(null);
      toast({ variante: "sucesso", titulo: "Rota reordenada", descricao: `≈ ${formatarKm(sugestao.metros)} de percurso` });
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível salvar a rota." });
    } finally {
      setSalvando(false);
    }
  }

  async function atribuir(parada: ParadaAgenda, tecnicoId: string) {
    if (!parada.ordemServico) return;
    try {
      await ordensServicoApi.atribuir(parada.ordemServico.id, tecnicoId);
      if (janela) void carregarParadas(janela.dia, janela.turno);
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível atribuir o técnico." });
    }
  }

  async function desmarcar(parada: ParadaAgenda) {
    if (!janela) return;
    setConfirmandoId(null);
    try {
      await agendaApi.desmarcar(parada.id);
      setCandidatas(null); // a OS volta a ser candidata; recarrega na próxima abertura
      await Promise.all([carregarParadas(janela.dia, janela.turno), carregarGrade()]);
      toast({ variante: "sucesso", titulo: "Visita desmarcada. A vaga voltou pra grade." });
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível desmarcar." });
    }
  }

  const config = grade?.config;

  return (
    <AppShell>
      <AnimatedPage>
        <div className="flex flex-col gap-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">Agenda de visitas</h1>
              <p className="text-sm text-muted-foreground">
                Onde ainda cabe, e em que ordem visitar. Instalação e reparo dividem o mesmo teto — são os mesmos
                técnicos.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setSemana((s) => somarDias(s, -7))}
                aria-label="Semana anterior"
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setSemana(inicioDaSemana(hoje))}
                disabled={semana === inicioDaSemana(hoje)}
                className="rounded px-2 py-1 text-xs font-medium hover:bg-muted disabled:text-muted-foreground disabled:hover:bg-transparent"
              >
                Hoje
              </button>
              <span className="min-w-28 text-center text-xs tabular-nums text-muted-foreground">
                {rotuloDia(dias[0])} – {rotuloDia(dias[6])}
              </span>
              <button
                type="button"
                onClick={() => setSemana((s) => somarDias(s, 7))}
                aria-label="Próxima semana"
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            {config ? (
              <button
                type="button"
                onClick={() => setEditandoLimites(true)}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="size-3.5" aria-hidden />
                {config.vagasManha} manhã · {config.vagasTarde} tarde
                {config.vagasDia != null ? ` · ${config.vagasDia}/dia` : ""}
                {config.tetoRegiao != null ? ` · ${config.tetoRegiao} por região` : ""}
                {config.vagasRetiradaDia ? ` · ${config.vagasRetiradaDia} reservadas à retirada` : ""}
                {config.vagasPorTecnico != null ? ` · ${config.vagasPorTecnico} por técnico (escala)` : ""}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void propor()}
              disabled={propondo}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <Wand2 className="size-3.5" aria-hidden />
              {propondo ? "Calculando…" : "Propor agenda"}
            </button>
            <button
              type="button"
              onClick={() => setPainelAberto((v) => !v)}
              aria-pressed={painelAberto}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <CalendarDays className="size-3.5" aria-hidden />
              Painel 14 dias
            </button>
          </header>

          {painelAberto ? <PainelQuinzena hoje={hoje} aoFechar={() => setPainelAberto(false)} /> : null}

          {proposta ? (
            <PropostaAuto
              proposta={proposta}
              saude={saude}
              ocupado={aplicando}
              aoAplicar={(n) => void aplicarLote(n)}
              aoDesfazer={() => void desfazerLote()}
              aoFechar={() => setProposta(null)}
            />
          ) : null}

          <Card>
            <CardContent className="p-0">
              {carregando ? (
                <div className="flex flex-col gap-2 p-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-11 w-full" />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div
                    className="grid min-w-[720px] gap-1.5 p-3"
                    style={{ gridTemplateColumns: "4.5rem repeat(7, minmax(0, 1fr))" }}
                  >
                    <span />
                    {dias.map((dia) => {
                      const ehHoje = dia === hoje;
                      return (
                        <div
                          key={dia}
                          className={`rounded-md px-2 py-1 text-center text-xs font-semibold tabular-nums ${ehHoje ? "bg-primary/10 text-primary" : dia < hoje ? "text-muted-foreground/60" : "text-muted-foreground"}`}
                        >
                          {rotuloDia(dia)}
                          {ehHoje ? <span className="ml-1 text-[10px] font-normal uppercase">hoje</span> : null}
                        </div>
                      );
                    })}
                    {TURNOS_AGENDA.map((t) => (
                      <div key={t} className="contents">
                        <span className="flex items-center text-xs font-medium text-muted-foreground">{ROTULO_TURNO[t]}</span>
                        {dias.map((dia) => {
                          const v = porJanela.get(`${dia}|${t}`);
                          if (!v) return <span key={dia} />;
                          // Dia que já passou: esmaecido, sem "Prazo curto" (que
                          // ali é ruído — é óbvio que não dá mais pra marcar).
                          // Só abre se houve visita, pra rever a rota feita.
                          if (dia < hoje) {
                            return (
                              <button
                                key={dia}
                                type="button"
                                disabled={v.ocupadas === 0}
                                onClick={() => abrir(dia, t)}
                                aria-label={`${ROTULO_TURNO[t]} de ${rotuloDia(dia)}: ${v.ocupadas} de ${v.capacidade}, dia passado`}
                                className="flex min-h-[4.5rem] flex-col justify-center rounded-md border border-dashed border-border/60 px-2.5 py-2 text-left text-sm text-muted-foreground/60 transition enabled:hover:border-foreground/30 disabled:cursor-default"
                              >
                                <span className="tabular-nums">{v.ocupadas > 0 ? `${v.ocupadas} visita${v.ocupadas === 1 ? "" : "s"}` : "—"}</span>
                              </button>
                            );
                          }
                          // Todo turno que EXISTE abre: vazio também — é onde se
                          // marca. Só o que o calendário fechou fica inerte.
                          const clicavel = !fechadoNoCalendario(v);
                          const ativo = janela?.dia === dia && janela.turno === t;
                          const pct = v.capacidade > 0 ? Math.min(100, Math.round((v.ocupadas / v.capacidade) * 100)) : 0;
                          return (
                            <button
                              key={dia}
                              type="button"
                              disabled={!clicavel}
                              onClick={() => abrir(dia, t)}
                              aria-label={`${ROTULO_TURNO[t]} de ${rotuloDia(dia)}: ${v.ocupadas} de ${v.capacidade}, ${textoBloqueio(v)}`}
                              className={`flex min-h-[4.5rem] flex-col justify-between gap-1 rounded-md border px-2.5 py-2 text-left text-sm transition ${tomDaVaga(v)} ${
                                ativo ? "border-primary ring-2 ring-primary/30" : "border-border"
                              } ${clicavel ? "hover:border-foreground/30" : "cursor-default opacity-80"}`}
                            >
                              <span className="flex items-center justify-between gap-1">
                                <span className="text-base font-semibold tabular-nums">
                                  {fechadoNoCalendario(v) ? "—" : `${v.ocupadas}/${v.capacidade}`}
                                </span>
                                {v.bloqueio && !fechadoNoCalendario(v) && v.bloqueio !== "antecedencia" ? (
                                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                                ) : null}
                              </span>
                              {!fechadoNoCalendario(v) ? (
                                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                                  <span className="block h-full rounded-full bg-current opacity-70" style={{ width: `${pct}%` }} />
                                </span>
                              ) : null}
                              <span className="flex items-center justify-between gap-1 text-[11px] leading-tight">
                                <span className="truncate">
                                  {textoBloqueio(v)}
                                  {v.tecnicosEscalados != null && !v.bloqueio ? ` · ${v.tecnicosEscalados} téc.` : ""}
                                </span>
                                {v.ocupadas > 0 ? (
                                  <span className="shrink-0 text-muted-foreground">
                                    {v.instalacao}i · {v.reparo}r
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <RotaDeAgora hoje={hoje} onAbrir={abrir} />

          {editandoLimites && config ? (
            <LimitesDaAgenda
              config={config}
              aoFechar={() => setEditandoLimites(false)}
              aoSalvar={async (patch) => {
                await agendaApi.salvarConfig(patch);
                setEditandoLimites(false);
                await carregarGrade();
                toast({ variante: "sucesso", titulo: "Limites atualizados." });
              }}
            />
          ) : null}

          <AnimatePresence>
            {janela ? (
              <motion.aside
                key="rota"
                initial={shouldReduceMotion ? false : { x: 32, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={shouldReduceMotion ? undefined : { x: 32, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                aria-label="Rota do turno"
                className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-y-auto border-l border-border bg-background shadow-2xl sm:max-w-md"
              >

                <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
                    <h2 className="text-sm font-semibold">
                      Rota de {rotuloDia(janela.dia)} · {ROTULO_TURNO[janela.turno]}
                    </h2>
                    {salvando ? <span className="text-xs text-muted-foreground">salvando…</span> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => fecharJanela()}
                    aria-label="Fechar rota"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </header>

                {/*
                  Sugestao de ordem: o sistema propoe, o supervisor decide. Mostra
                  os dois percursos lado a lado — sem o numero da ordem atual, a
                  sugestao nao tem contra o que ser julgada.
                */}
                {paradas.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => void sugerir()}
                      disabled={sugerindo || salvando}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium hover:bg-muted disabled:opacity-50"
                    >
                      <Route className="size-3.5" aria-hidden />
                      {sugerindo ? "Calculando…" : "Sugerir ordem"}
                    </button>
                    {sugestao ? (
                      <>
                        <span className="text-muted-foreground">
                          atual ≈ <span className="font-medium text-foreground">{formatarKm(sugestao.metrosAtual)}</span> · sugerida ≈{" "}
                          <span className="font-medium text-foreground">{formatarKm(sugestao.metros)}</span>
                          {sugestao.semCoordenada > 0 ? ` · ${sugestao.semCoordenada} sem localização (vão pro fim)` : ""}
                          {!sugestao.comOrigem ? " · sem base cadastrada" : ""}
                        </span>
                        {sugestao.ordem.join() !== paradas.map((p) => p.id).join() ? (
                          <button
                            type="button"
                            onClick={() => void aplicarSugestao()}
                            disabled={salvando}
                            className="rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            Aplicar
                          </button>
                        ) : (
                          <span className="text-muted-foreground">já está na melhor ordem</span>
                        )}
                      </>
                    ) : null}
                  </div>
                ) : null}

                {carregandoParadas ? (
                  <div className="flex flex-col gap-2 p-4">
                    {[0, 1].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : paradas.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Nenhuma visita marcada neste turno.</p>
                ) : (
                  <ol className="divide-y divide-border">
                    {paradas.map((p, i) => {
                      const os = p.ordemServico;
                      return (
                        <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          {/*
                            Setas e não arrastar: o supervisor reordena tanto no
                            desktop quanto no celular na rua, e arrastar não
                            funciona com teclado nem com leitor de tela.
                          */}
                          <div className="flex flex-col">
                            <button
                              type="button"
                              disabled={i === 0 || salvando}
                              onClick={() => void mover(i, -1)}
                              aria-label={`Subir ${os?.clienteNome ?? p.sgpOsId} na rota`}
                              className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                            >
                              <ArrowUp className="size-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              disabled={i === paradas.length - 1 || salvando}
                              onClick={() => void mover(i, 1)}
                              aria-label={`Descer ${os?.clienteNome ?? p.sgpOsId} na rota`}
                              className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                            >
                              <ArrowDown className="size-3.5" aria-hidden />
                            </button>
                          </div>

                          <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">
                            {i + 1}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 truncate text-sm font-medium">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: p.provedor.cor }}
                                aria-hidden
                              />
                              {os?.clienteNome ?? `OS ${p.sgpOsId}`}
                              {/*
                                O SGP ainda não confirmou esta data. Não é erro —
                                a agenda daqui é a verdade —, mas quem só olha o
                                ERP do provedor ainda não vê esta visita.
                              */}
                              {/*
                                O cliente respondeu o lembrete. Visita confirmada
                                é visita que provavelmente acontece — e a diferença
                                entre as duas é o deslocamento perdido.
                              */}
                              {p.confirmadoEm ? (
                                <span
                                  title={`Confirmada pelo cliente em ${new Date(p.confirmadoEm).toLocaleString("pt-BR")}`}
                                  className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400"
                                >
                                  <CheckCircle2 className="size-3" aria-hidden />
                                  confirmada
                                </span>
                              ) : null}
                              {p.remarcacoesCliente > 0 ? (
                                <span
                                  title="Remarcações pedidas pelo próprio cliente"
                                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                >
                                  <RefreshCw className="size-3" aria-hidden />
                                  {p.remarcacoesCliente}×
                                </span>
                              ) : null}
                              {p.sgpConfirmadoEm === null ? (
                                <span
                                  title="Ainda não confirmado no SGP do provedor"
                                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                >
                                  <CloudOff className="size-3" aria-hidden />
                                  SGP
                                </span>
                              ) : null}
                            </p>
                            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              {/* A categoria ISPhub, como na Fila; o texto cru do SGP só se não houver. */}
                              <span
                                className="font-medium"
                                style={os?.tipoOs?.categoria ? { color: os.tipoOs.categoria.cor } : undefined}
                              >
                                {os?.tipoOs?.categoria?.nome ?? os?.tipoOs?.descricao ?? "—"}
                              </span>
                              {os?.bairro || os?.pop ? (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="size-3" aria-hidden />
                                  {[os.logradouro, os.numero].filter(Boolean).join(", ") || os.bairro || os.pop}
                                </span>
                              ) : null}
                              {os?.telefone ? (
                                <span className="inline-flex items-center gap-1">
                                  <Phone className="size-3" aria-hidden />
                                  {os.telefone}
                                </span>
                              ) : null}
                              <span>{p.marcadoPor ? `por ${p.marcadoPor}` : `origem ${p.origem}`}</span>
                            </p>
                            {os?.apoios?.length ? (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Apoio: {os.apoios.map((a) => a.nomeExibicao ?? a.nome).join(", ")}
                              </p>
                            ) : null}
                            {observacaoVisivel(p.observacao) ? (
                              <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-800 dark:text-amber-300">
                                <StickyNote className="mt-0.5 size-3 shrink-0" aria-hidden />
                                <span className="line-clamp-2">{observacaoVisivel(p.observacao)}</span>
                              </p>
                            ) : null}
                          </div>

                          <select
                            aria-label={`Técnico de ${os?.clienteNome ?? p.sgpOsId}`}
                            disabled={!os}
                            value={os?.tecnico?.id ?? ""}
                            onChange={(ev) => ev.target.value && void atribuir(p, ev.target.value)}
                            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          >
                            <option value="">Sem técnico</option>
                            {tecnicos.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.nome}
                              </option>
                            ))}
                          </select>

                          {confirmandoId === p.id ? (
                            <span className="flex items-center gap-1 text-xs">
                              <span className="text-muted-foreground">Desmarcar?</span>
                              <button
                                type="button"
                                onClick={() => void desmarcar(p)}
                                className="rounded-md bg-destructive px-2 py-1 font-medium text-destructive-foreground hover:opacity-90"
                              >
                                Sim
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmandoId(null)}
                                className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
                              >
                                Não
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmandoId(p.id)}
                              aria-label={`Desmarcar ${os?.clienteNome ?? p.sgpOsId}`}
                              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                            >
                              Desmarcar
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              
                <section className="border-t border-border">
                  <header className="flex items-center gap-2 px-4 pb-2 pt-3">
                    <CalendarPlus className="size-4 text-muted-foreground" aria-hidden />
                    <h3 className="text-sm font-semibold">Adicionar OS neste turno</h3>
                    {candidatas ? (
                      <span className="text-xs text-muted-foreground">
                        {candidatas.filter((c) => !c.diaAgenda).length} sem visita
                      </span>
                    ) : null}
                  </header>
                  <div className="px-4 pb-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <Input
                        value={buscaOs}
                        onChange={(e) => setBuscaOs(e.target.value)}
                        placeholder="Cliente, protocolo, contrato ou nº da OS"
                        aria-label="Buscar OS sem visita"
                        className="pl-8"
                      />
                    </div>
                  </div>
                  {candidatas === null ? (
                    <div className="flex flex-col gap-2 px-4 pb-4">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : candidatasVisiveis.length === 0 ? (
                    <p className="px-4 pb-4 text-sm text-muted-foreground">
                      {buscaOs ? "Nenhuma OS sem visita com esse texto." : "Todas as OS abertas já têm visita marcada."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {candidatasVisiveis.map((c) => (
                        <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: c.provedor.cor }} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{c.clienteNome ?? `OS ${c.sgpOsId}`}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              OS #{c.sgpOsId}
                              {c.categoria ? ` · ${c.categoria.nome}` : ""}
                              {c.endereco?.bairro || c.pop ? ` · ${c.endereco?.bairro ?? c.pop}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={marcandoId !== null}
                            onClick={() => void marcarNaJanela(c)}
                            className="rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                          >
                            {marcandoId === c.id ? "Marcando…" : "Marcar"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </motion.aside>
            ) : null}
          </AnimatePresence>
        </div>
      </AnimatedPage>
    </AppShell>
  );
}

/**
 * OS LIMITES — quantas visitas cabem, por turno e por dia.
 *
 * Dois tetos e não um: o do turno é quantas visitas cabem numa saída; o do dia
 * é quantas a equipe aguenta antes de a última virar madrugada. Com 20+20 e um
 * teto diário de 30, as 10 últimas não são oferecidas em turno nenhum.
 *
 * O que for salvo aqui vale para TODOS os caminhos de agendamento — a atendente
 * no Inbox, o bot e o autoatendimento leem a mesma grade. É o ponto único que a
 * planilha nunca teve: lá a capacidade era uma célula que só a fórmula lia.
 */
function LimitesDaAgenda({
  config,
  aoFechar,
  aoSalvar,
}: {
  config: AgendaConfigDto;
  aoFechar: () => void;
  aoSalvar: (patch: Partial<AgendaConfigDto>) => Promise<void>;
}) {
  const [manha, setManha] = useState(config.vagasManha);
  const [tarde, setTarde] = useState(config.vagasTarde);
  const [dia, setDia] = useState<number | "">(config.vagasDia ?? "");
  const [regiao, setRegiao] = useState<number | "">(config.tetoRegiao ?? "");
  const [dias, setDias] = useState<number[]>(config.diasAtendidos);
  const [antecedencia, setAntecedencia] = useState(config.antecedenciaMin);
  const [horizonte, setHorizonte] = useState(config.horizonteDias);
  const [remarcacoes, setRemarcacoes] = useState(config.remarcacoesMaxCliente);
  const [baseLat, setBaseLat] = useState<string>(config.baseLat != null ? String(config.baseLat) : "");
  const [baseLng, setBaseLng] = useState<string>(config.baseLng != null ? String(config.baseLng) : "");
  const [porTecnico, setPorTecnico] = useState<number | "">(config.vagasPorTecnico ?? "");
  const [retiradaDia, setRetiradaDia] = useState<number | "">(config.vagasRetiradaDia ?? 0);
  const [autoAtiva, setAutoAtiva] = useState(config.autoAgendaAtiva ?? false);
  const [autoMax, setAutoMax] = useState<number | "">(config.autoAgendaMaxRodada ?? 20);
  const [urgenciaDia, setUrgenciaDia] = useState<number | "">(config.vagasUrgenciaDia ?? 0);
  const [domingo, setDomingo] = useState<number | "">(config.vagasDomingo ?? "");
  const [salvando, setSalvando] = useState(false);

  const nomesDias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

  async function salvar() {
    setSalvando(true);
    try {
      await aoSalvar({
        vagasManha: manha,
        vagasTarde: tarde,
        vagasDia: dia === "" ? null : Number(dia),
        tetoRegiao: regiao === "" ? null : Number(regiao),
        diasAtendidos: dias,
        antecedenciaMin: antecedencia,
        horizonteDias: horizonte,
        remarcacoesMaxCliente: remarcacoes,
        // Os dois juntos ou nenhum: metade de uma coordenada nao e origem.
        baseLat: baseLat.trim() && baseLng.trim() ? Number(baseLat) : null,
        baseLng: baseLat.trim() && baseLng.trim() ? Number(baseLng) : null,
        vagasPorTecnico: porTecnico === "" ? null : Number(porTecnico),
        vagasRetiradaDia: retiradaDia === "" ? 0 : Number(retiradaDia),
        autoAgendaAtiva: autoAtiva,
        autoAgendaMaxRodada: autoMax === "" ? 20 : Number(autoMax),
        vagasUrgenciaDia: urgenciaDia === "" ? 0 : Number(urgenciaDia),
        vagasDomingo: domingo === "" ? null : Number(domingo),
      });
    } finally {
      setSalvando(false);
    }
  }

  const somaTurnos = manha + tarde;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Limites da agenda</h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar limites"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Vagas por turno — manhã</span>
            <input
              type="number"
              min={0}
              max={500}
              value={manha}
              onChange={(e) => setManha(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Vagas por técnico (pela escala)</span>
            <input
              type="number"
              min={1}
              max={50}
              value={porTecnico}
              onChange={(e) => setPorTecnico(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="vazio = só as vagas fixas"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground">
              Preenchido, cada turno oferece no máximo escalados × este número (sem passar das vagas fixas). Dia sem escala continua com as fixas.
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Retirada: fatia reservada por dia</span>
            <input
              type="number"
              min={0}
              max={500}
              value={retiradaDia}
              onChange={(e) => setRetiradaDia(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground">
              Parte do que o dia comporta guardada para retirada de kit — não é vaga extra. 0 = a retirada só usa a sobra.
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Domingo: limite de visitas</span>
            <input
              type="number"
              min={0}
              max={500}
              value={domingo}
              onChange={(e) => setDomingo(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground">
              Domingo só tem a manhã. Vazio = vale o limite normal do turno. Para fechar o domingo, desmarque "dom" nos dias atendidos.
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Urgência: vagas guardadas por dia</span>
            <input
              type="number"
              min={0}
              max={500}
              value={urgenciaDia}
              onChange={(e) => setUrgenciaDia(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground">
              Guardadas para "sem conexão" nos dias além de amanhã; na véspera voltam para as demais. 0 = sem reserva.
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={autoAtiva} onChange={(e) => setAutoAtiva(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-foreground">Agendamento automático de instalação e reparo</span>
              <span className="block text-muted-foreground">
                A cada 10 min marca sozinho. A retirada nunca sai sozinha, só por lote aprovado. O técnico continua sendo escolhido por você.
              </span>
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Máximo de marcações por rodada</span>
            <input
              type="number"
              min={1}
              max={200}
              value={autoMax}
              onChange={(e) => setAutoMax(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground">Trava contra enxurrada se algo sair errado.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Base da equipe (latitude)</span>
            <input
              type="text"
              inputMode="decimal"
              value={baseLat}
              onChange={(e) => setBaseLat(e.target.value)}
              placeholder="-5.8580"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground">De onde a equipe sai — origem da rota sugerida.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Base da equipe (longitude)</span>
            <input
              type="text"
              inputMode="decimal"
              value={baseLng}
              onChange={(e) => setBaseLng(e.target.value)}
              placeholder="-35.3530"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Vagas por turno — tarde</span>
            <input
              type="number"
              min={0}
              max={500}
              value={tarde}
              onChange={(e) => setTarde(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Teto do dia</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={dia}
              placeholder={`sem teto (${somaTurnos})`}
              onChange={(e) => setDia(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground">
              {/* Vazio não é "zero": é "o limite do dia é a soma dos turnos". */}
              Vazio = a soma dos turnos ({somaTurnos}).
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Teto por região, no turno</span>
            <input
              type="number"
              min={1}
              max={500}
              value={regiao}
              placeholder="sem teto"
              onChange={(e) => setRegiao(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground">Evita o dia todo no mesmo bairro.</span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Dias atendidos</span>
            <div className="flex flex-wrap gap-1">
              {nomesDias.map((nome, i) => {
                const marcado = dias.includes(i);
                return (
                  <button
                    key={nome}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() => setDias((d) => (marcado ? d.filter((x) => x !== i) : [...d, i].sort()))}
                    className={`rounded-md border px-2 py-1 ${marcado ? "border-foreground/40 bg-muted font-medium text-foreground" : "border-border text-muted-foreground"}`}
                  >
                    {nome}
                  </button>
                );
              })}
            </div>
            <span className="text-muted-foreground">Dia desmarcado não é ofertado nem com a agenda vazia.</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs">
              <span className="font-medium text-foreground">Antecedência mínima (min)</span>
              <input
                type="number"
                min={0}
                max={10080}
                value={antecedencia}
                onChange={(e) => setAntecedencia(Number(e.target.value))}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
              <span className="text-muted-foreground">Não oferecer a manhã de hoje às 11h.</span>
            </label>
            <label className="flex flex-col gap-1.5 text-xs">
              <span className="font-medium text-foreground">Dias à frente</span>
              <input
                type="number"
                min={1}
                max={90}
                value={horizonte}
                onChange={(e) => setHorizonte(Number(e.target.value))}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs">
              <span className="font-medium text-foreground">Remarcações do cliente</span>
              <input
                type="number"
                min={0}
                max={10}
                value={remarcacoes}
                onChange={(e) => setRemarcacoes(Number(e.target.value))}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
              <span className="text-muted-foreground">Passou disso, a conversa vai para um atendente.</span>
            </label>
          </div>
        </div>

        <ExcecoesDoCalendario />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || dias.length === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {salvando ? "Salvando…" : "Salvar limites"}
          </button>
          {/* Sem dia atendido nenhum a agenda nunca ofereceria nada, e a tela
              ficaria vazia sem dizer por quê. */}
          {dias.length === 0 && <span className="text-xs text-destructive">Escolha ao menos um dia.</span>}
          <span className="ml-auto text-xs text-muted-foreground">
            Vale para o Inbox, o bot e o autoatendimento — todos leem esta grade.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * OS DIAS QUE FOGEM DA REGRA — feriado municipal que fecha, mutirão que abre.
 *
 * Feriado NACIONAL não aparece aqui e não precisa ser cadastrado: ele é
 * calculado, inclusive os que mudam de data todo ano (Carnaval, Sexta-feira
 * Santa, Corpus Christi). Uma lista digitada à mão erra por omissão, e erra
 * sempre em dezembro.
 */
function ExcecoesDoCalendario() {
  const { toast } = useToast();
  const [itens, setItens] = useState<ExcecaoAgenda[] | null>(null);
  const [dia, setDia] = useState("");
  const [motivo, setMotivo] = useState("");
  const [atende, setAtende] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void agendaApi.excecoes().then(setItens).catch(() => setItens([]));
  }, []);

  async function adicionar() {
    if (!dia || !motivo.trim()) return;
    setSalvando(true);
    try {
      setItens(await agendaApi.salvarExcecao({ dia, atende, motivo: motivo.trim() }));
      setDia("");
      setMotivo("");
      setAtende(false);
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível salvar o dia." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <div>
        <h3 className="text-xs font-medium text-foreground">Dias que fogem da regra</h3>
        <p className="text-xs text-muted-foreground">
          Feriado municipal que fecha, ou sábado de mutirão que abre. Os feriados nacionais já são calculados — não
          precisa cadastrar.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <input
          type="date"
          aria-label="Dia"
          value={dia}
          onChange={(e) => setDia(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        />
        <input
          aria-label="Motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Padroeira de Macaíba"
          className="min-w-48 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          onKeyDown={(e) => e.key === "Enter" && void adicionar()}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={atende} onChange={(e) => setAtende(e.target.checked)} />
          Atende mesmo assim
        </label>
        <button
          type="button"
          onClick={() => void adicionar()}
          disabled={salvando || !dia || !motivo.trim()}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Adicionar
        </button>
      </div>

      {itens && itens.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {itens.map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              {/*
                Os dois casos precisam se distinguir de relance: um tira um dia
                da agenda, o outro põe. Só o texto não separa numa lista longa.
              */}
              {e.atende ? (
                <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
              ) : (
                <CalendarOff className="size-3.5 text-muted-foreground" aria-hidden />
              )}
              <span className="w-24 tabular-nums">{rotuloDia(e.dia)}</span>
              <span className="flex-1 truncate">{e.motivo}</span>
              <span className="text-muted-foreground">{e.atende ? "atende" : "fechado"}</span>
              <button
                type="button"
                aria-label={`Remover ${e.motivo}`}
                onClick={() =>
                  void agendaApi
                    .removerExcecao(e.dia)
                    .then(setItens)
                    .catch(() => toast({ variante: "erro", titulo: "Não foi possível remover." }))
                }
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {itens?.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum dia cadastrado além dos feriados nacionais.</p>
      )}
    </div>
  );
}

/**
 * A rota do turno em curso, em leitura, embaixo da grade. Quem abre a Agenda
 * de manhã quer saber primeiro "quem está indo aonde agora" — e a metade de
 * baixo da tela ficava vazia até alguém clicar num turno. Não abre a gaveta
 * sozinha: no celular ela cobre a tela inteira e esconderia a grade.
 */
function RotaDeAgora({ hoje, onAbrir }: { hoje: string; onAbrir: (dia: string, turno: TurnoAgenda) => void }) {
  const horaBr = (new Date().getUTCHours() + 21) % 24;
  const turno = turnoDaHora(horaBr);
  const { data: paradas } = useQuery({
    queryKey: ["agenda", "turno", hoje, turno],
    queryFn: () => agendaApi.doTurno(hoje, turno),
  });
  if (!paradas) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Route className="size-4 text-primary" aria-hidden />
            Rota de agora · {ROTULO_TURNO[turno]} de hoje
          </h2>
          {paradas.length > 0 ? (
            <button
              type="button"
              onClick={() => onAbrir(hoje, turno)}
              className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Abrir a rota <ChevronRight className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
        {paradas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma visita marcada para este turno.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {paradas.map((p, i) => {
              const os = p.ordemServico;
              return (
                <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
                    {p.ordemRota ?? i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{os?.clienteNome ?? p.sgpOsId}</span>
                    {os?.bairro ? <span className="text-muted-foreground"> · {os.bairro}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {os?.tecnico ? (os.tecnico.nomeExibicao ?? os.tecnico.nome) : "sem técnico"}
                    {os?.apoios?.length ? ` + ${os.apoios.map((a) => a.nomeExibicao ?? a.nome).join(", ")}` : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Revisao da proposta automatica. Nao grava nada e nao escolhe tecnico: mostra o
 * que o motor sugere, por dia, e o que ficou de fora. Aplicar em lote e outra fase.
 */
function PropostaAuto({
  proposta,
  saude,
  ocupado,
  aoAplicar,
  aoDesfazer,
  aoFechar,
}: {
  proposta: ResultadoAuto;
  saude: SaudeAgendador | null;
  ocupado: boolean;
  aoAplicar: (n: number) => void;
  aoDesfazer: () => void;
  aoFechar: () => void;
}) {
  const [quantas, setQuantas] = useState(30);
  const porDia = new Map<string, ResultadoAuto["propostas"]>();
  for (const p of proposta.propostas) porDia.set(p.dia, [...(porDia.get(p.dia) ?? []), p]);
  return (
    <Card>
      <CardContent className="p-0">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Wand2 className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">Proposta de agenda</h2>
          <span className="text-xs text-muted-foreground">
            {proposta.propostas.length} propostas · {proposta.revisao.length} para revisão · {proposta.semVaga.length} sem vaga no horizonte
          </span>
          <button type="button" onClick={aoFechar} aria-label="Fechar proposta" className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" aria-hidden />
          </button>
        </header>
        {saude ? (
          <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
            Agendador {saude.ativa ? "ligado" : "desligado"}
            {saude.rodadaAtrasada ? " · ⚠ sem rodar há mais de 30 min" : ""}
            {saude.ultimaRodada ? ` · última rodada: ${saude.ultimaRodada.marcadas} marcadas, ${saude.ultimaRodada.recusadas} recusadas${saude.ultimaRodada.erro ? ` (erro: ${saude.ultimaRodada.erro})` : ""}` : ""}
            {` · ${saude.vagasOciosasAmanha} vagas ociosas amanhã · ${saude.semConfirmacaoAmanha} sem confirmação amanhã · ${saude.pendentesNoSgp} pendentes no SGP · ${saude.osAbertasHaMaisDe7Dias} OS abertas há mais de 7 dias`}
          </p>
        ) : null}
        {proposta.propostas.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
            <label className="flex items-center gap-1.5">
              Aplicar as primeiras
              <input
                type="number"
                min={1}
                max={200}
                value={quantas}
                onChange={(e) => setQuantas(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                className="w-16 rounded-md border border-border bg-background px-2 py-1"
              />
            </label>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => aoAplicar(quantas)}
              className="rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
            >
              {ocupado ? "Aplicando…" : "Aplicar lote"}
            </button>
            <button type="button" disabled={ocupado} onClick={aoDesfazer} className="rounded-md border border-border px-2.5 py-1.5 font-medium hover:bg-muted disabled:opacity-50">
              Desfazer lote de hoje
            </button>
          </div>
        ) : null}
        {proposta.propostas.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">Nenhuma OS para propor agora.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {[...porDia.entries()].map(([dia, itens]) => (
              <section key={dia}>
                <h3 className="sticky top-0 bg-muted/60 px-4 py-1.5 text-xs font-semibold backdrop-blur">
                  {rotuloDiaAgenda(dia)} · {itens.length}
                </h3>
                <ul className="divide-y divide-border">
                  {itens.map((p) => (
                    <li key={`${p.provedorId}-${p.sgpOsId}`} className="flex items-center gap-3 px-4 py-2">
                      <span className="w-12 shrink-0 text-xs font-medium">{ROTULO_TURNO[p.turno]}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {p.clienteNome ?? `OS ${p.sgpOsId}`} <span className="text-xs font-normal text-muted-foreground">OS #{p.sgpOsId}{p.regiao ? ` · ${p.regiao}` : ""}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{p.motivo}</p>
                      </div>
                      {p.fila === "retirada" ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs">retirada</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {proposta.revisao.length > 0 ? (
          <details className="border-t border-border px-4 py-2 text-xs">
            <summary className="cursor-pointer font-medium">{proposta.revisao.length} OS para revisão manual</summary>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {proposta.revisao.slice(0, 50).map((r) => (
                <li key={`${r.provedorId}-${r.sgpOsId}`}>OS #{r.sgpOsId} — {r.motivo}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * A aba "Painel" da planilha: os proximos 14 dias, instalacao e reparo por turno,
 * total contra a capacidade e a situacao. "Acima da capacidade" so acontece com o
 * que veio da planilha (o ISPhub nao deixa marcar acima do limite).
 */
function PainelQuinzena({ hoje, aoFechar }: { hoje: string; aoFechar: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["agenda", "painel14", hoje],
    queryFn: () => agendaApi.grade({ de: hoje, ate: somarDias(hoje, 13) }),
  });
  const porDia = new Map<string, Partial<Record<TurnoAgenda, VagaTurno>>>();
  for (const v of data?.vagas ?? []) porDia.set(v.dia, { ...porDia.get(v.dia), [v.turno]: v });

  const situacao = (v?: VagaTurno) => {
    if (!v || ["feriado", "dia_nao_atendido", "turno_nao_atendido"].includes(v.bloqueio ?? "")) {
      return { texto: v?.bloqueio === "feriado" ? "Feriado" : "Sem atendimento", cls: "text-muted-foreground" };
    }
    if (v.ocupadas > v.capacidade) return { texto: "Acima da capacidade", cls: "font-semibold text-destructive" };
    if (v.ocupadas === v.capacidade) return { texto: "Lotado", cls: "font-medium text-amber-700 dark:text-amber-400" };
    return { texto: "OK", cls: "text-emerald-700 dark:text-emerald-400" };
  };

  return (
    <Card>
      <CardContent className="p-0">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">Painel — próximos 14 dias</h2>
          <span className="text-xs text-muted-foreground">i = instalação · r = reparo · total/capacidade</span>
          <button type="button" onClick={aoFechar} aria-label="Fechar painel" className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" aria-hidden />
          </button>
        </header>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="px-4 py-4 text-sm text-destructive">Não foi possível carregar o painel.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Dia</th>
                  {TURNOS_AGENDA.map((t) => (
                    <th key={t} className="px-3 py-2 font-medium" colSpan={2}>
                      {ROTULO_TURNO[t]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...porDia.entries()].map(([dia, turnos]) => (
                  <tr key={dia}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium">{rotuloDiaAgenda(dia)}</td>
                    {TURNOS_AGENDA.map((t) => {
                      const v = turnos[t];
                      const sit = situacao(v);
                      const aberto = sit.texto !== "Sem atendimento" && sit.texto !== "Feriado";
                      return [
                        <td key={`${t}-n`} className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                          {aberto && v ? `${v.instalacao}i · ${v.reparo}r · ${v.ocupadas}/${v.capacidade}` : "—"}
                        </td>,
                        <td key={`${t}-s`} className={`whitespace-nowrap px-3 py-1.5 ${sit.cls}`}>
                          {sit.texto}
                        </td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
