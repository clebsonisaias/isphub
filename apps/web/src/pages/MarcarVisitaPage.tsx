import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Phone, Search } from "lucide-react";
import { ROTULO_TURNO, type FilaItem, type TurnoAgenda } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MarcarVisitaDialog } from "@/components/MarcarVisitaDialog";
import { useToast } from "@/context/ToastContext";
import { agendaApi } from "@/lib/agendaApi";
import { filaApi } from "@/lib/filaApi";
import { ApiError } from "@/lib/apiClient";
import { buscarOs, faltaMarcar, rotuloCurto, rotuloLongo } from "@/lib/marcarVisita";
import { cn } from "@/lib/utils";

/**
 * MARCAR VISITA — a tela da atendente ao telefone: buscar o cliente, oferecer
 * as próximas vagas e marcar. Antes ela precisava achar a OS na fila e abrir o
 * diálogo; aqui a primeira coisa na tela é a busca, e as vagas vêm prontas para
 * ler ao cliente. "Ver outros dias" abre a grade completa (o diálogo de sempre).
 */

const VAGAS_OFERECIDAS = 4;

function mensagem(err: unknown) {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

interface Feita {
  id: string;
  dia: string;
  turno: TurnoAgenda;
  /** Visita que a OS tinha antes: "Desfazer" volta para ela em vez de desmarcar. */
  anterior: { dia: string; turno: TurnoAgenda } | null;
}

export function MarcarVisitaPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const busca = useRef<HTMLInputElement>(null);
  const [termo, setTermo] = useState("");
  const [escolhidaId, setEscolhidaId] = useState<string | null>(null);
  const [vaga, setVaga] = useState(0);
  const [observacao, setObservacao] = useState("");
  const [marcando, setMarcando] = useState(false);
  const [feita, setFeita] = useState<Feita | null>(null);
  const [gradeAberta, setGradeAberta] = useState(false);

  const fila = useQuery({
    queryKey: ["fila", { grupo: "abertos", equipe: "interna", marcar: true }],
    queryFn: () => filaApi.listar({ grupo: "abertos", equipe: "interna" }),
  });
  const minhas = useQuery({ queryKey: ["agenda", "minhas"], queryFn: () => agendaApi.minhas() });

  const resultados = useMemo(() => buscarOs(fila.data?.itens ?? [], termo), [fila.data, termo]);
  const aMarcar = useMemo(() => faltaMarcar(fila.data?.itens ?? []), [fila.data]);
  // Pelo id na fila inteira (não só nos resultados): a lista "Falta marcar" escolhe sem depender da busca.
  const os: FilaItem | null =
    (escolhidaId ? fila.data?.itens.find((i) => i.id === escolhidaId) : undefined) ??
    (resultados.length === 1 ? resultados[0]! : null);
  const regiao = os ? (os.pop ?? os.endereco?.bairro ?? undefined) : undefined;

  const proximas = useQuery({
    queryKey: ["agenda", "proximas", regiao ?? "", os?.id],
    queryFn: () => agendaApi.proximas(8, regiao),
    enabled: !!os,
  });
  // A vaga em que a OS já está não é oferta: remarcar para o mesmo lugar não muda nada.
  const ofertas = (proximas.data ?? [])
    .filter((v) => !(v.dia === os?.diaAgenda && v.turno === os?.turnoAgenda))
    .slice(0, VAGAS_OFERECIDAS);
  const escolhida = ofertas[vaga] ?? ofertas[0];

  function novaBusca(valor: string) {
    setTermo(valor);
    setEscolhidaId(null);
    setVaga(0);
    setFeita(null);
  }

  function atualizar() {
    void queryClient.invalidateQueries({ queryKey: ["fila"] });
    void queryClient.invalidateQueries({ queryKey: ["agenda"] });
  }

  async function marcar() {
    if (!os || !escolhida) return;
    setMarcando(true);
    try {
      const { id } = await agendaApi.marcar({
        provedorId: os.provedorId,
        sgpOsId: os.sgpOsId,
        dia: escolhida.dia,
        turno: escolhida.turno,
        regiao: regiao ?? null,
        observacao: observacao.trim() || undefined,
      });
      setFeita({
        id,
        dia: escolhida.dia,
        turno: escolhida.turno,
        anterior: os.diaAgenda && os.turnoAgenda ? { dia: os.diaAgenda, turno: os.turnoAgenda } : null,
      });
      setObservacao("");
      atualizar();
    } catch (e) {
      // 409 chega com o motivo ("Turno lotado", "Limite da região"...): a vaga acabou entre a busca e o clique.
      toast({ variante: "erro", titulo: "Não deu para marcar", descricao: mensagem(e) });
      void proximas.refetch();
    } finally {
      setMarcando(false);
    }
  }

  async function desfazer() {
    if (!os || !feita) return;
    setMarcando(true);
    try {
      if (feita.anterior) {
        await agendaApi.marcar({ provedorId: os.provedorId, sgpOsId: os.sgpOsId, ...feita.anterior, regiao: regiao ?? null });
      } else {
        await agendaApi.desmarcar(feita.id);
      }
      setFeita(null);
      toast({ variante: "sucesso", titulo: feita.anterior ? "Visita voltou para a data anterior" : "Visita desmarcada" });
      atualizar();
    } catch (e) {
      toast({ variante: "erro", titulo: "Não deu para desfazer", descricao: mensagem(e) });
    } finally {
      setMarcando(false);
    }
  }

  /** Clique na lista "Falta marcar": abre a OS no painel como se tivesse buscado pelo número. */
  function abrirDaLista(i: FilaItem) {
    novaBusca(i.sgpOsId);
    setEscolhidaId(i.id);
    window.scrollTo({ top: 0 });
  }

  function marcarOutra() {
    novaBusca("");
    busca.current?.focus();
  }

  const endereco = os
    ? [[os.endereco?.logradouro, os.endereco?.numero].filter(Boolean).join(", "), os.endereco?.bairro, os.endereco?.cidade ?? os.pop]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <AppShell>
      <AnimatedPage>
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[999_1_34rem] flex-col gap-5">
            <h1 className="text-2xl font-bold tracking-tight">Marcar visita</h1>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="busca-cliente" className="text-sm font-semibold">
                Cliente, CPF, contrato, telefone ou nº da OS
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  id="busca-cliente"
                  ref={busca}
                  type="search"
                  autoFocus
                  autoComplete="off"
                  value={termo}
                  onChange={(e) => novaBusca(e.target.value)}
                  className="h-13 w-full rounded-lg border-2 border-foreground/80 bg-card pl-11 pr-4 text-lg outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                />
              </div>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {fila.isPending
                  ? "Carregando as OS abertas…"
                  : termo.trim().length === 0
                    ? "Digite pelo menos 2 letras do nome ou 3 números."
                    : resultados.length === 0
                      ? "Nenhuma OS aberta encontrada. Confira o nome ou tente o CPF."
                      : `${resultados.length} OS aberta${resultados.length === 1 ? "" : "s"} encontrada${resultados.length === 1 ? "" : "s"}`}
              </span>
            </div>

            {!os && resultados.length > 1 ? (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {resultados.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => setEscolhidaId(i.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60"
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: i.categoria?.cor ?? "#64748b" }} aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-semibold">{i.clienteNome ?? "Cliente não identificado"}</span>
                        <span className="truncate text-sm text-muted-foreground">
                          {i.categoria?.nome ?? "Sem categoria"}
                          {i.endereco?.bairro || i.pop ? `, ${i.endereco?.bairro ?? i.pop}` : ""}
                          {i.diaAgenda && i.turnoAgenda ? `. Visita marcada: ${rotuloCurto(i.diaAgenda)}, ${ROTULO_TURNO[i.turnoAgenda].toLowerCase()}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">OS {i.sgpOsId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {os ? (
              <section aria-labelledby="cliente" className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold"
                      style={{ background: `${os.categoria?.cor ?? "#64748b"}1f`, color: os.categoria?.cor ?? "#64748b" }}
                    >
                      <span className="size-2 rounded-full" style={{ background: os.categoria?.cor ?? "#64748b" }} aria-hidden />
                      {os.categoria?.nome ?? "Sem categoria"}
                    </span>
                    <span className="font-semibold tabular-nums">OS {os.sgpOsId}</span>
                    {os.dataCadastro ? (
                      <span className="text-muted-foreground">
                        aberta em {dataCurta(os.dataCadastro)}
                        {os.usuario ? ` por ${os.usuario}` : ""}
                      </span>
                    ) : null}
                    {resultados.length > 1 ? (
                      <button type="button" onClick={() => setEscolhidaId(null)} className="ml-auto text-sm font-medium text-primary hover:underline">
                        Ver os {resultados.length} resultados
                      </button>
                    ) : null}
                  </div>
                  <h2 id="cliente" className="text-2xl font-bold leading-tight">
                    {os.clienteNome ?? "Cliente não identificado"}
                  </h2>
                  {endereco ? <p className="text-muted-foreground">{endereco}{os.contratoId ? `. Contrato ${os.contratoId}.` : "."}</p> : null}
                  {os.conteudo ? <p className="line-clamp-3 text-muted-foreground">{os.conteudo}</p> : null}
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                    {os.telefone ? (
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Phone className="size-3.5" aria-hidden />
                        {os.telefone}
                      </span>
                    ) : null}
                    {os.tecnicoNome ? (
                      <span>
                        Técnico: {os.tecnicoNome}
                        {os.apoioNomes?.length ? `, com ${os.apoioNomes.join(", ")}` : ""}
                      </span>
                    ) : null}
                  </div>
                  {os.diaAgenda && os.turnoAgenda && !feita ? (
                    <p className="mt-1 rounded-md bg-secondary px-3 py-2 text-sm">
                      Já tem visita para <span className="font-semibold">{rotuloLongo(os.diaAgenda, os.turnoAgenda)}</span>. Escolha outra vaga
                      para remarcar.
                    </p>
                  ) : null}
                </div>

                {feita ? (
                  <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg bg-success/10 px-4 py-3.5 text-success">
                    <CheckCircle2 className="size-6 shrink-0" aria-hidden />
                    <span className="min-w-[14rem] flex-1 text-base font-semibold">
                      Visita {feita.anterior ? "remarcada" : "marcada"} para {rotuloLongo(feita.dia, feita.turno)}.
                    </span>
                    <Button variant="outline" size="sm" onClick={() => void desfazer()} disabled={marcando}>
                      Desfazer
                    </Button>
                    <Button variant="ghost" size="sm" onClick={marcarOutra}>
                      Marcar outra
                    </Button>
                  </div>
                ) : (
                  <>
                    <fieldset className="flex flex-col gap-2.5">
                      <legend className="mb-2.5 text-base font-bold">Ofereça ao cliente</legend>
                      {proximas.isPending ? (
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(9rem,100%),1fr))] gap-2.5">
                          {[0, 1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-[5.25rem] rounded-lg" />
                          ))}
                        </div>
                      ) : ofertas.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sem vaga livre nos próximos dias para esta região. Veja os outros dias.</p>
                      ) : (
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(9rem,100%),1fr))] gap-2.5">
                          {ofertas.map((v, i) => {
                            const ativa = v === escolhida;
                            return (
                              <button
                                key={`${v.dia}|${v.turno}`}
                                type="button"
                                aria-pressed={ativa}
                                onClick={() => setVaga(i)}
                                className={cn(
                                  "flex min-h-[5.25rem] flex-col items-start gap-0.5 rounded-lg px-3.5 py-3 text-left transition-colors",
                                  ativa ? "border-2 border-primary bg-primary/10" : "border border-border bg-card hover:bg-secondary",
                                )}
                              >
                                <span className="text-base font-bold">{rotuloCurto(v.dia)}</span>
                                <span className="text-sm">{ROTULO_TURNO[v.turno]}</span>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                  {v.livres} vaga{v.livres === 1 ? "" : "s"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <button type="button" onClick={() => setGradeAberta(true)} className="self-start text-sm font-medium text-primary hover:underline">
                        Ver outros dias
                      </button>
                    </fieldset>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="obs-visita">
                        Observação para o técnico <span className="font-normal text-muted-foreground">(opcional)</span>
                      </Label>
                      <Textarea
                        id="obs-visita"
                        rows={2}
                        maxLength={500}
                        value={observacao}
                        onChange={(e) => setObservacao(e.target.value)}
                        placeholder="Ex.: cliente em casa só depois das 10h"
                      />
                    </div>

                    <Button size="lg" className="self-start" onClick={() => void marcar()} disabled={marcando || !escolhida}>
                      {marcando
                        ? "Marcando…"
                        : escolhida
                          ? `${os.diaAgenda ? "Remarcar" : "Marcar visita"} para ${rotuloLongo(escolhida.dia, escolhida.turno)}`
                          : "Escolha uma vaga"}
                    </Button>
                  </>
                )}
              </section>
            ) : null}
          </div>

          <aside className="flex min-w-0 flex-[1_1_17rem] flex-col gap-4 lg:max-w-[21rem]">
            <section aria-labelledby="falta-marcar" className="rounded-xl border border-border bg-card">
              <h2 id="falta-marcar" className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 text-base font-bold">
                Falta marcar
                {fila.data ? <span className="text-sm font-semibold tabular-nums text-muted-foreground">{aMarcar.length}</span> : null}
              </h2>
              {fila.isPending ? (
                <div className="flex flex-col gap-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : aMarcar.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Todas as OS abertas já têm visita.</p>
              ) : (
                <ul className="max-h-[min(28rem,55vh)] divide-y divide-border overflow-y-auto">
                  {aMarcar.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => abrirDaLista(i)}
                        aria-current={os?.id === i.id ? "true" : undefined}
                        className={cn("flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-secondary/60", os?.id === i.id && "bg-primary/10")}
                      >
                        <span className="size-2 shrink-0 rounded-full" style={{ background: i.categoria?.cor ?? "#64748b" }} aria-hidden />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-semibold">{i.clienteNome ?? `OS ${i.sgpOsId}`}</span>
                          <span className="truncate text-sm text-muted-foreground">
                            {i.categoria?.nome ?? "Sem categoria"}
                            {i.endereco?.bairro || i.pop ? `, ${i.endereco?.bairro ?? i.pop}` : ""}
                          </span>
                        </span>
                        {i.dataCadastro ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{dataCurta(i.dataCadastro)}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="feitas-hoje" className="rounded-xl border border-border bg-card">
              <h2 id="feitas-hoje" className="border-b border-border px-4 py-3 text-base font-bold">
                Marcadas por você hoje
              </h2>
              {minhas.isPending ? (
                <div className="flex flex-col gap-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (minhas.data ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhuma ainda hoje.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(minhas.data ?? []).map((m) => (
                    <li key={m.id} className="flex justify-between gap-3 px-4 py-2.5">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">{m.clienteNome ?? `OS ${m.sgpOsId}`}</span>
                        <span className="text-sm text-muted-foreground">
                          {rotuloCurto(m.dia)}, {ROTULO_TURNO[m.turno].toLowerCase()}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{hora(m.em)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </AnimatedPage>

      {gradeAberta && os ? (
        <MarcarVisitaDialog
          item={os}
          onClose={() => setGradeAberta(false)}
          onMarcado={(dia, turno, agendamentoId) => {
            setGradeAberta(false);
            setFeita({
              id: agendamentoId,
              dia,
              turno,
              anterior: os.diaAgenda && os.turnoAgenda ? { dia: os.diaAgenda, turno: os.turnoAgenda } : null,
            });
            atualizar();
          }}
        />
      ) : null}
    </AppShell>
  );
}
