import { useEffect, useMemo, useRef, useState } from "react";
import { createScope, animate, stagger, type Scope } from "animejs";
import { OS_STATUS_ABERTOS, UserRole, type Categoria, type FilaItem, type Provedor } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { filaApi } from "@/lib/filaApi";
import { categoriasApi, provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { OrdemServicoDetailDialog } from "@/components/OrdemServicoDetailDialog";
import { OcorrenciaDetailDialog } from "@/components/OcorrenciaDetailDialog";
import { FilaSidebar } from "@/components/fila/FilaSidebar";
import { FilaCard } from "@/components/fila/FilaCard";
import {
  FILA_FACET_INICIAL,
  calcularFacetas,
  filtrarFila,
  ordenarFila,
  type FilaFacetState,
  type OrdenacaoFila,
} from "@/lib/filaFacets";
import { Search, SlidersHorizontal, ChevronLeft, ChevronRight, AlarmClock, Inbox, ListChecks } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/** OS concluída/cancelada, ou ocorrência já finalizada no SGP (dataFinalizacao preenchida). */
function estaFinalizado(item: FilaItem): boolean {
  return item.kind === "os" ? !OS_STATUS_ABERTOS.includes(item.status) : item.dataFinalizacao != null;
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

export function PainelPage() {
  const { usuario } = useAuth();
  const { toast } = useToast();
  const ehProvedor = usuario?.role === UserRole.PROVEDOR;
  const ehTecnico = usuario?.role === UserRole.TECNICO;

  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [itens, setItens] = useState<FilaItem[]>([]);
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

  // Carrega um lote generoso e faz faceta/ordenação/paginação no cliente
  // (contadores da sidebar sempre exatos). Só a busca vai ao servidor.
  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    filaApi
      .listar({ busca: buscaDebounced || undefined, pageSize: 500 })
      .then((resp) => {
        if (!cancelado) setItens(resp.itens);
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
  }, [buscaDebounced, refetch]);

  // Concluídas ficam numa aba separada da fila operacional — evita misturar
  // trabalho já encerrado com o que ainda precisa de ação, tanto na lista
  // quanto nos contadores/filtros da sidebar (que passam a refletir só a
  // aba ativa).
  const contagemPorAba = useMemo(() => {
    let fila = 0;
    let concluidas = 0;
    for (const i of itens) (estaFinalizado(i) ? concluidas++ : fila++);
    return { fila, concluidas };
  }, [itens]);
  const itensDaAba = useMemo(
    () => itens.filter((i) => estaFinalizado(i) === (visao === "concluidas")),
    [itens, visao],
  );

  const facetas = useMemo(() => calcularFacetas(itensDaAba, filtros), [itensDaAba, filtros]);
  const filtrados = useMemo(
    () => ordenarFila(filtrarFila(itensDaAba, filtros), ordenacao),
    [itensDaAba, filtros, ordenacao],
  );

  const estat = useMemo(() => {
    const abertas = itens.filter((i) => i.kind === "os" && i.status !== "concluida" && i.status !== "cancelada").length;
    const estourado = itens.filter((i) => i.kind === "os" && i.sla.semaforo === "vermelho").length;
    return { total: itens.length, abertas, estourado };
  }, [itens]);

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
      categorias={categorias}
      mostrarProvedores={!ehProvedor && !ehTecnico}
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
          <h1 className="text-2xl font-bold tracking-tight">Painel Unificado</h1>
          <p className="text-sm text-muted-foreground">
            {ehTecnico
              ? "Suas ordens de serviço"
              : `Ocorrências e ordens de serviço de ${ehProvedor ? "seu provedor" : "todos os provedores"}`}
          </p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <EstatCard
            icon={<Inbox className="size-4" />}
            valor={estat.total}
            label="na fila"
            tom="bg-primary/10 text-primary"
          />
          <EstatCard
            icon={<ListChecks className="size-4" />}
            valor={estat.abertas}
            label="OS abertas"
            tom="bg-secondary text-foreground"
          />
          <EstatCard
            icon={<AlarmClock className="size-4" />}
            valor={estat.estourado}
            label="SLA estourado"
            tom="bg-destructive/10 text-destructive"
          />
        </div>
      </div>

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
              <TabsTrigger value="fila">Fila ({contagemPorAba.fila})</TabsTrigger>
              <TabsTrigger value="concluidas">Concluídas ({contagemPorAba.concluidas})</TabsTrigger>
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
                className="pl-8"
              />
            </div>

            <select
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as OrdenacaoFila)}
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              aria-label="Ordenar por"
            >
              <option value="urgencia">Ordenar: urgência</option>
              <option value="recentes">Ordenar: mais recentes</option>
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

          {/* Contador + paginação */}
          <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {filtrados.length === 0
                ? "Nenhum item"
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

          {/* Lista */}
          {carregando ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
              ))}
            </div>
          ) : paginaItens.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Nenhum item encontrado com os filtros atuais.
              </CardContent>
            </Card>
          ) : (
            <div ref={listRef} className="flex flex-col gap-2.5">
              {paginaItens.map((item) => (
                <FilaCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  agora={agora}
                  onClick={() => setSelecionado(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selecionado && selecionado.kind === "os" && (
        <OrdemServicoDetailDialog
          item={selecionado}
          onClose={() => setSelecionado(null)}
          onAtualizado={() => {
            setSelecionado(null);
            setRefetch((n) => n + 1);
          }}
        />
      )}
      {selecionado && selecionado.kind === "ocorrencia" && (
        <OcorrenciaDetailDialog item={selecionado} onClose={() => setSelecionado(null)} />
      )}
    </AppShell>
  );
}
