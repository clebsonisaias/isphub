import { useEffect, useMemo, useRef, useState } from "react";
import { createScope, animate, stagger, type Scope } from "animejs";
import { OS_STATUS_ABERTOS, UserRole, type Categoria, type EquipeFiltro, type FilaItem, type Provedor } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { filaApi } from "@/lib/filaApi";
import { categoriasApi, provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { OrdemServicoDetailDialog } from "@/components/OrdemServicoDetailDialog";
import { FilaSidebar } from "@/components/fila/FilaSidebar";
import { FilaChipsAtivos } from "@/components/fila/FilaChipsAtivos";
import { FilaCard } from "@/components/fila/FilaCard";
import {
  FILA_FACET_INICIAL,
  calcularFacetas,
  filtrarFila,
  ordenarFila,
  type FilaFacetState,
  type OrdenacaoFila,
} from "@/lib/filaFacets";
import {
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  AlarmClock,
  Inbox,
  ListChecks,
  AlertTriangle,
  Loader2,
  Info,
} from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/** OS concluída ou cancelada (fora dos status "abertos"). */
function estaFinalizado(item: FilaItem): boolean {
  return !OS_STATUS_ABERTOS.includes(item.status);
}

const TAMANHOS_PAGINA = [10, 20, 50];

function EstatCard({ icon, valor, label, tom }: { icon: React.ReactNode; valor: number; label: string; tom: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <span className={`flex size-9 items-center justify-center rounded-lg ${tom}`}>{icon}</span>
      <div className="leading-tight">
        <p className="text-xl font-bold tabular-nums text-foreground">{valor}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export interface FilaWorkspaceProps {
  /** Qual fila esta tela mostra. Vai direto pro servidor — o corte é feito no
   *  banco, nunca na memória do cliente (senão contadores e paginação mentem). */
  equipe: EquipeFiltro;
  titulo: string;
  subtitulo: string;
  /** Rótulos da aba/estat de "abertas" (Painel: "Fila"/"Na fila"; Retiradas: "A retirar"). */
  rotuloAbertas?: string;
  rotuloEstatAbertas?: string;
  vazioAbertas?: string;
  vazioConcluidas?: string;
  /** Mostrado quando nenhuma categoria pertence a esta tela (ex.: Retiradas
   *  antes de o admin marcar alguma categoria como "outra equipe"). */
  dicaSemCategorias?: string;
}

/**
 * Corpo compartilhado do Painel (OS internas) e da tela de Retiradas (OS de
 * equipe externa) — mesma estrutura (abas, sidebar de filtros, busca, chips,
 * ordenação, cards), parametrizada por `equipe`. O corte OS interna/externa
 * acontece no servidor (ver equipeService.ts); aqui só filtramos QUAIS
 * categorias aparecem na sidebar/chips, pra "Retirada" não aparecer zerada no
 * Painel nem uma categoria da casa aparecer na tela de Retiradas.
 */
export function FilaWorkspace({
  equipe,
  titulo,
  subtitulo,
  rotuloAbertas = "Fila",
  rotuloEstatAbertas = "Na fila",
  vazioAbertas = "Nenhuma OS aberta no momento.",
  vazioConcluidas = "Nenhuma OS concluída ainda.",
  dicaSemCategorias,
}: FilaWorkspaceProps) {
  const { usuario } = useAuth();
  const { toast } = useToast();
  const ehProvedor = usuario?.role === UserRole.PROVEDOR;
  const ehTecnico = usuario?.role === UserRole.TECNICO;

  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [itens, setItens] = useState<FilaItem[]>([]);
  // Contagem real por grupo (do banco): nao depende do que coube na pagina.
  const [totais, setTotais] = useState({ osAbertas: 0, osFechadas: 0, osSlaEstourado: 0 });
  // true quando o grupo ativo tem mais itens do que o servidor devolve de uma
  // vez — a lista mostra os mais recentes e o aviso pede pra refinar.
  const [truncado, setTruncado] = useState(false);
  // Total real de OS do grupo no banco (pra o aviso de truncamento dizer "de N").
  const [totalServidor, setTotalServidor] = useState(0);
  const [carregando, setCarregando] = useState(true);

  const [visao, setVisao] = useState<"fila" | "concluidas">("fila");
  const [filtros, setFiltros] = useState<FilaFacetState>(FILA_FACET_INICIAL);
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [ordenacao, setOrdenacao] = useState<OrdenacaoFila>("urgencia");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [sidebarMobile, setSidebarMobile] = useState(false);

  const [selecionado, setSelecionado] = useState<FilaItem | null>(null);
  const [refetch, setRefetch] = useState(0);
  // "Aberta há" recalcula a cada minuto sem re-fetch.
  const [agora, setAgora] = useState(() => Date.now());

  const listRef = useRef<HTMLDivElement>(null);
  const scope = useRef<Scope | null>(null);

  useEffect(() => {
    provedoresApi.listar().then(setProvedores).catch(() => {});
    categoriasApi
      .listar()
      .then((cats) => setCategorias(cats.filter((c) => c.ativo)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 350);
    return () => clearTimeout(t);
  }, [busca]);

  // Carrega o conjunto COMPLETO do grupo ativo (todos os provedores) e faz
  // faceta/ordenação/paginação no cliente — por isso os contadores da sidebar
  // batem exato. Sem provedorId: o filtro de provedor é uma faceta local sobre
  // dados completos, não um corte no servidor (era o que fazia um provedor
  // sumir quando o volume passava do antigo teto de 500). Só a busca e a
  // equipe (interna/externa) vão ao servidor — equipe é o recorte que garante
  // que esta tela nunca mistura com a outra.
  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    filaApi
      .listar({
        busca: buscaDebounced || undefined,
        // So o grupo da aba ativa: sem isso, uma base com muita OS encerrada
        // consome o teto de registros e esconde as abertas.
        grupo: visao === "concluidas" ? "fechados" : "abertos",
        equipe,
      })
      .then((resp) => {
        if (!cancelado) {
          setItens(resp.itens);
          setTotais(resp.totais);
          setTruncado(resp.truncado);
          setTotalServidor(resp.total);
        }
      })
      .catch((err) => {
        if (!cancelado) toast({ titulo: "Erro ao carregar a fila", descricao: mensagem(err), variante: "erro" });
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visao, buscaDebounced, refetch, equipe]);

  // Concluídas ficam numa aba separada da fila operacional — evita misturar
  // trabalho já encerrado com o que ainda precisa de ação, tanto na lista
  // quanto nos contadores/filtros da sidebar (que passam a refletir só a
  // aba ativa). O servidor já devolve só o grupo da aba; o filtro aqui é
  // defesa em profundidade. Os contadores das abas vêm dos totais do banco,
  // não do que coube na página.
  const itensDaAba = useMemo(
    () => itens.filter((i) => estaFinalizado(i) === (visao === "concluidas")),
    [itens, visao],
  );

  // A sidebar/chips listam todas as categorias ativas, não só as do lote —
  // sem este recorte, "Retirada / Cancelamento" apareceria zerada no Painel
  // (e uma categoria da casa apareceria na tela de Retiradas).
  const categoriasDaTela = useMemo(
    () => categorias.filter((c) => (equipe === "externa" ? c.equipeExterna : !c.equipeExterna)),
    [categorias, equipe],
  );

  const facetas = useMemo(() => calcularFacetas(itensDaAba, filtros), [itensDaAba, filtros]);
  const filtrados = useMemo(
    () => ordenarFila(filtrarFila(itensDaAba, filtros), ordenacao),
    [itensDaAba, filtros, ordenacao],
  );

  // As metricas do topo sao sobre o trabalho que ainda precisa de acao (OS
  // aberta/a caminho/em execucao/pendente). Concluidas entram num contador
  // proprio, so pra controle — misturar as duas escondia o numero que de
  // fato importa pra operacao do dia.
  // Vem do banco (nao do lote carregado): o alerta de SLA e o numero de
  // abertas precisam valer em qualquer aba e independem da paginacao. O SLA
  // conta so as abertas — OS encerrada nao esta estourando prazo nenhum.
  const estat = {
    abertas: totais.osAbertas,
    estourado: totais.osSlaEstourado,
    concluidas: totais.osFechadas,
  };

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / pageSize));
  const pageSegura = Math.min(page, totalPaginas);
  const inicio = (pageSegura - 1) * pageSize;
  const paginaItens = filtrados.slice(inicio, inicio + pageSize);

  // Volta pra página 1 quando filtro/busca/tamanho/aba muda.
  useEffect(() => {
    setPage(1);
  }, [visao, filtros, ordenacao, pageSize, buscaDebounced]);

  function patchFiltro(patch: Partial<FilaFacetState>) {
    setFiltros((prev) => ({ ...prev, ...patch }));
  }

  const temFiltroAtivo =
    filtros.status !== "todos" ||
    filtros.prioridade !== "todas" ||
    filtros.categoriaId !== "todas" ||
    filtros.provedorId !== "todos" ||
    busca.trim() !== "";

  function limparFiltros() {
    setFiltros(FILA_FACET_INICIAL);
    setBusca("");
  }

  function removerFiltro(dim: "status" | "prioridade" | "categoriaId" | "provedorId" | "busca") {
    if (dim === "busca") {
      setBusca("");
      return;
    }
    patchFiltro({ [dim]: FILA_FACET_INICIAL[dim] } as Partial<FilaFacetState>);
  }

  // "Buscando" enquanto o debounce ainda não confirmou ou o fetch está em voo.
  const buscando = busca !== buscaDebounced || (carregando && itens.length > 0);
  // Skeleton só na primeira carga; re-fetches mantêm a lista (esmaecida).
  const primeiraCarga = carregando && itens.length === 0;

  // Entrada escalonada dos cards a cada re-render da página exibida.
  useEffect(() => {
    if (carregando || !listRef.current) return;
    scope.current?.revert();
    scope.current = createScope({ root: listRef }).add(() => {
      animate(".fila-item", {
        opacity: [0, 1],
        translateY: [8, 0],
        duration: 300,
        delay: stagger(22, { start: 0 }),
        ease: "outQuad",
      });
    });
    return () => scope.current?.revert();
  }, [paginaItens, carregando]);

  const sidebar = (
    <FilaSidebar
      filtros={filtros}
      facetas={facetas}
      provedores={provedores}
      categorias={categoriasDaTela}
      mostrarProvedores={!ehProvedor && !ehTecnico}
      totalOs={itensDaAba.length}
      onChange={(patch) => {
        patchFiltro(patch);
        setSidebarMobile(false);
      }}
    />
  );

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
          <p className="text-sm text-muted-foreground">{subtitulo}</p>
        </div>
        {/* Abertas e SLA em destaque (o trabalho do dia); concluídas em tom
            neutro, só como controle. */}
        <div className="hidden gap-2 sm:flex">
          <EstatCard
            icon={<Inbox className="size-4" />}
            valor={estat.abertas}
            label={rotuloEstatAbertas}
            tom="bg-primary/10 text-primary"
          />
          <EstatCard
            icon={<AlarmClock className="size-4" />}
            valor={estat.estourado}
            label="SLA estourado"
            tom="bg-destructive/10 text-destructive"
          />
          <EstatCard
            icon={<ListChecks className="size-4" />}
            valor={estat.concluidas}
            label="concluídas"
            tom="bg-secondary text-muted-foreground"
          />
        </div>
      </div>

      {/* Dica quando nenhuma categoria pertence a esta tela ainda (ex.:
          Retiradas antes de o admin marcar alguma categoria). */}
      {dicaSemCategorias && categoriasDaTela.length === 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>{dicaSemCategorias}</span>
        </div>
      )}

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* Sidebar de filtros */}
        <aside className="lg:w-60 lg:shrink-0">
          <div className="hidden lg:sticky lg:top-20 lg:block">{sidebar}</div>

          {/* Toggle mobile */}
          <button
            type="button"
            onClick={() => setSidebarMobile((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium lg:hidden"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="size-4" />
              Filtros
            </span>
            <ChevronRight className={`size-4 transition-transform ${sidebarMobile ? "rotate-90" : ""}`} />
          </button>
          {sidebarMobile && <div className="mt-2 rounded-lg border border-border bg-card p-2 lg:hidden">{sidebar}</div>}
        </aside>

        {/* Conteúdo */}
        <div className="min-w-0 flex-1">
          <Tabs value={visao} onValueChange={(v) => setVisao(v as "fila" | "concluidas")} className="mb-4">
            <TabsList>
              <TabsTrigger value="fila">
                {rotuloAbertas} ({totais.osAbertas})
              </TabsTrigger>
              <TabsTrigger value="concluidas">Concluídas ({totais.osFechadas})</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Cliente, protocolo, contrato, endereço..."
                className="pl-8 pr-8"
              />
              {buscando && (
                <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            <select
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as OrdenacaoFila)}
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              aria-label="Ordenar por"
            >
              <option value="urgencia">Mais urgentes primeiro</option>
              <option value="recentes">Mais recentes primeiro</option>
              <option value="antigas">Mais antigas primeiro</option>
            </select>

            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              aria-label="Itens por página"
            >
              {TAMANHOS_PAGINA.map((n) => (
                <option key={n} value={n}>
                  {n} por página
                </option>
              ))}
            </select>
          </div>

          {/* Chips dos filtros ativos + limpar — deixa visível por que a lista
              está curta, em vez de o usuário achar que "sumiu" dado. */}
          <FilaChipsAtivos
            filtros={filtros}
            busca={busca}
            categorias={categoriasDaTela}
            provedores={provedores}
            onRemover={removerFiltro}
            onLimpar={limparFiltros}
          />

          {/* Contador + paginação */}
          <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {filtrados.length === 0
                ? "Nenhuma OS"
                : `Mostrando ${inicio + 1}–${Math.min(inicio + pageSize, filtrados.length)} de ${filtrados.length}`}
            </span>
            {totalPaginas > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageSegura <= 1}
                  className="flex size-8 items-center justify-center rounded-md border border-border disabled:opacity-40 enabled:hover:bg-secondary"
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="px-1 tabular-nums">
                  {pageSegura} / {totalPaginas}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}
                  disabled={pageSegura >= totalPaginas}
                  className="flex size-8 items-center justify-center rounded-md border border-border disabled:opacity-40 enabled:hover:bg-secondary"
                  aria-label="Próxima página"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </div>

          {/* Aviso honesto de truncamento: há mais OS no banco do que o painel
              carrega de uma vez. Nunca esconder dados em silêncio. */}
          {truncado && !primeiraCarga && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                Mostrando as {itens.length.toLocaleString("pt-BR")} OS mais recentes de{" "}
                {totalServidor.toLocaleString("pt-BR")}. Use a busca ou os filtros da barra lateral pra encontrar o
                restante.
              </span>
            </div>
          )}

          {/* Lista */}
          {primeiraCarga ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
              ))}
            </div>
          ) : paginaItens.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
                {temFiltroAtivo ? (
                  <>
                    <span>Nenhuma OS com os filtros atuais.</span>
                    <Button variant="outline" size="sm" onClick={limparFiltros}>
                      Limpar filtros
                    </Button>
                  </>
                ) : (
                  <span>{visao === "concluidas" ? vazioConcluidas : vazioAbertas}</span>
                )}
              </CardContent>
            </Card>
          ) : (
            <div
              ref={listRef}
              className={cn("flex flex-col gap-2.5 transition-opacity", carregando && "pointer-events-none opacity-60")}
            >
              {paginaItens.map((item) => (
                <FilaCard key={item.id} item={item} agora={agora} onClick={() => setSelecionado(item)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {selecionado && (
        <OrdemServicoDetailDialog
          item={selecionado}
          onClose={() => setSelecionado(null)}
          onAtualizado={() => {
            setSelecionado(null);
            setRefetch((n) => n + 1);
          }}
        />
      )}
    </AppShell>
  );
}
