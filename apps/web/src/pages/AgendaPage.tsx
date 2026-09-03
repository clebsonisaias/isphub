import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarDays, CalendarOff, CheckCircle2, CloudOff, MapPin, Phone, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import { ROTULO_TURNO, TURNOS_AGENDA, type AgendaConfigDto, type TurnoAgenda, type VagaTurno } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/context/ToastContext";
import { ordensServicoApi, tecnicosApi, type TecnicoResumo } from "@/lib/filaApi";
import { agendaApi, type ExcecaoAgenda, type GradeResposta, type ParadaAgenda } from "@/lib/agendaApi";

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

const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function rotuloDia(dia: string) {
  const d = new Date(`${dia}T12:00:00Z`);
  return `${DIA_SEMANA[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Cor da célula. Só a urgência recebe cor — o resto fica neutro. */
function tomDaVaga(v: VagaTurno) {
  // Feriado é neutro, não vermelho: nada deu errado, o dia só não existe.
  if (v.bloqueio === "feriado") return "bg-muted/40 text-muted-foreground";
  if (v.bloqueio === "dia_nao_atendido") return "bg-muted/40 text-muted-foreground";
  if (v.bloqueio === "antecedencia") return "bg-muted/40 text-muted-foreground";
  if (v.bloqueio) return "bg-destructive/15 text-destructive";
  if (v.livres <= 3) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-background";
}

function textoBloqueio(v: VagaTurno) {
  switch (v.bloqueio) {
    case "lotado":
      return "Turno lotado";
    case "dia_lotado":
      // Não diz "turno": o dia inteiro fechou, e mandar tentar o outro turno
      // do mesmo dia só produziria a mesma recusa de novo.
      return "Dia lotado";
    case "regiao":
      return "Limite da região";
    case "feriado":
      // O motivo, não a palavra "feriado": um dia que some sem explicação vira
      // pergunta interna sobre por que sumiu.
      return v.motivoBloqueio ?? "Feriado";
    case "dia_nao_atendido":
      return "Sem atendimento";
    case "antecedencia":
      return "Prazo curto";
    default:
      return `${v.livres} livre${v.livres === 1 ? "" : "s"}`;
  }
}

export function AgendaPage() {
  const { toast } = useToast();
  const [grade, setGrade] = useState<GradeResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [janela, setJanela] = useState<{ dia: string; turno: TurnoAgenda } | null>(null);
  const [paradas, setParadas] = useState<ParadaAgenda[]>([]);
  const [carregandoParadas, setCarregandoParadas] = useState(false);
  const [tecnicos, setTecnicos] = useState<TecnicoResumo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [editandoLimites, setEditandoLimites] = useState(false);

  const carregarGrade = useCallback(async () => {
    setCarregando(true);
    try {
      setGrade(await agendaApi.grade());
    } catch {
      toast({ variante: "erro", titulo: "Não foi possível carregar a agenda." });
    } finally {
      setCarregando(false);
    }
  }, [toast]);

  useEffect(() => {
    void carregarGrade();
    void tecnicosApi.listar().then(setTecnicos).catch(() => setTecnicos([]));
  }, [carregarGrade]);

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

  function abrir(dia: string, turno: TurnoAgenda) {
    setJanela({ dia, turno });
    void carregarParadas(dia, turno);
  }

  /** A grade agrupada por dia — a aba "Painel" da planilha. */
  const porDia = useMemo(() => {
    const mapa = new Map<string, Partial<Record<TurnoAgenda, VagaTurno>>>();
    for (const v of grade?.vagas ?? []) {
      const linha = mapa.get(v.dia) ?? {};
      linha[v.turno] = v;
      mapa.set(v.dia, linha);
    }
    return [...mapa.entries()];
  }, [grade]);

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
    try {
      await agendaApi.desmarcar(parada.id);
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
              </button>
            ) : null}
          </header>

          <Card>
            <CardContent className="p-0">
              {carregando ? (
                <div className="flex flex-col gap-2 p-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-11 w-full" />
                  ))}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {porDia.map(([dia, turnos]) => (
                    <li key={dia} className="flex flex-wrap items-center gap-2 px-4 py-2">
                      <span className="w-24 shrink-0 text-sm font-medium tabular-nums">{rotuloDia(dia)}</span>
                      {TURNOS_AGENDA.map((t) => {
                        const v = turnos[t];
                        if (!v) return null;
                        const clicavel = v.bloqueio !== "dia_nao_atendido" && v.ocupadas > 0;
                        return (
                          <button
                            key={t}
                            type="button"
                            disabled={!clicavel}
                            onClick={() => abrir(dia, t)}
                            aria-label={`${ROTULO_TURNO[t]} de ${rotuloDia(dia)}: ${v.ocupadas} de ${v.capacidade}, ${textoBloqueio(v)}`}
                            className={`flex min-w-40 flex-1 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm transition ${tomDaVaga(v)} ${clicavel ? "hover:border-foreground/30" : "cursor-default"}`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{ROTULO_TURNO[t]}</span>
                              <span className="tabular-nums font-medium">
                                {v.ocupadas}/{v.capacidade}
                              </span>
                              {/* A planilha tinha uma aba pra cada tipo; aqui é uma linha só. */}
                              {v.ocupadas > 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  {v.instalacao} inst · {v.reparo} rep
                                </span>
                              ) : null}
                            </span>
                            <span className="flex items-center gap-1 text-xs">
                              {v.bloqueio &&
                              v.bloqueio !== "dia_nao_atendido" &&
                              v.bloqueio !== "feriado" &&
                              v.bloqueio !== "antecedencia" ? (
                                <AlertTriangle className="size-3.5" aria-hidden />
                              ) : null}
                              {textoBloqueio(v)}
                            </span>
                          </button>
                        );
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

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

          {janela ? (
            <Card>
              <CardContent className="p-0">
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
                    onClick={() => setJanela(null)}
                    aria-label="Fechar rota"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </header>

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
                              <span>{os?.tipoOs?.descricao ?? "—"}</span>
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

                          <button
                            type="button"
                            onClick={() => void desmarcar(p)}
                            aria-label={`Desmarcar ${os?.clienteNome ?? p.sgpOsId}`}
                            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                          >
                            Desmarcar
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          ) : null}
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
