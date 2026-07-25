import { useEffect, useMemo, useRef, useState } from "react";
import { createScope, animate, stagger, type Scope } from "animejs";
import {
  OS_STATUS_LABEL,
  OsStatus,
  UserRole,
  type FilaItem,
  type Provedor,
} from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { SlaBadge, SLA_PRIORIDADE } from "@/components/SlaBadge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { filaApi } from "@/lib/filaApi";
import { provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { OrdemServicoDetailDialog } from "@/components/OrdemServicoDetailDialog";
import { OcorrenciaDetailDialog } from "@/components/OcorrenciaDetailDialog";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";
import { Search } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/** Faixa colorida na borda esquerda do card, pelo semaforo de SLA (so OS tem SLA). */
function corUrgencia(item: FilaItem): string {
  if (item.kind !== "os") return "var(--border)";
  switch (item.sla.semaforo) {
    case "vermelho":
      return "var(--destructive)";
    case "amarelo":
      return "var(--warning)";
    case "verde":
      return "var(--success)";
    default:
      return "var(--border)";
  }
}

const STATUS_FILTRAVEIS = Object.values(OsStatus);

export function PainelPage() {
  const { usuario } = useAuth();
  const { toast } = useToast();

  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [provedorId, setProvedorId] = useState<string>("");
  const [statusAtivos, setStatusAtivos] = useState<Set<OsStatus>>(new Set());
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");

  const [itens, setItens] = useState<FilaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelecionado] = useState<FilaItem | null>(null);
  const [ordenarPorUrgencia, setOrdenarPorUrgencia] = useState(true);

  const itensExibidos = useMemo(() => {
    if (!ordenarPorUrgencia) return itens;
    // SLA estourado (vermelho) primeiro, depois atenção, depois no prazo; ocorrências (sem SLA) por último.
    return [...itens].sort((a, b) => {
      const pa = a.kind === "os" ? SLA_PRIORIDADE[a.sla.semaforo] : SLA_PRIORIDADE.sem_sla;
      const pb = b.kind === "os" ? SLA_PRIORIDADE[b.sla.semaforo] : SLA_PRIORIDADE.sem_sla;
      return pa - pb;
    });
  }, [itens, ordenarPorUrgencia]);

  const listRef = useRef<HTMLDivElement>(null);
  const scope = useRef<Scope | null>(null);

  useEffect(() => {
    provedoresApi.listar().then(setProvedores).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 350);
    return () => clearTimeout(t);
  }, [busca]);

  async function carregar() {
    setCarregando(true);
    try {
      const resp = await filaApi.listar({
        provedorId: provedorId || undefined,
        status: statusAtivos.size ? Array.from(statusAtivos) : undefined,
        busca: buscaDebounced || undefined,
        pageSize: 50,
      });
      setItens(resp.itens);
      setTotal(resp.total);
    } catch (err) {
      toast({ titulo: "Erro ao carregar a fila", descricao: mensagem(err), variante: "erro" });
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provedorId, statusAtivos, buscaDebounced]);

  // Micro-interacao: entrada escalonada dos itens da fila a cada atualizacao da lista.
  useEffect(() => {
    if (carregando || !listRef.current) return;
    scope.current?.revert();
    scope.current = createScope({ root: listRef }).add(() => {
      animate(".fila-item", {
        opacity: [0, 1],
        translateY: [8, 0],
        duration: 350,
        delay: stagger(25, { start: 0 }),
        ease: "outQuad",
      });
    });
    return () => scope.current?.revert();
  }, [itensExibidos, carregando]);

  function toggleStatus(s: OsStatus) {
    setStatusAtivos((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const provedorSelecionado = useMemo(() => provedores.find((p) => p.id === provedorId), [provedores, provedorId]);

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Painel Unificado</h1>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "item" : "itens"} na fila
            {provedorSelecionado ? ` — ${provedorSelecionado.nome}` : " de todos os provedores"}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Cliente, protocolo, endereço..."
              className="pl-8"
            />
          </div>

          {usuario?.role !== UserRole.PROVEDOR && (
            <select
              value={provedorId}
              onChange={(e) => setProvedorId(e.target.value)}
              className="h-10 rounded-md border border-input bg-secondary/40 px-3 text-sm"
            >
              <option value="">Todos os provedores</option>
              {provedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTRAVEIS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                statusAtivos.has(s)
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {OS_STATUS_LABEL[s]}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setOrdenarPorUrgencia((v) => !v)}
            className={`ml-auto rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              ordenarPorUrgencia
                ? "border-warning bg-warning/15 text-warning"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground"
            }`}
            title="Prioriza itens com SLA estourado ou perto do prazo"
          >
            Ordenar por urgência
          </button>
        </div>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : itensExibidos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum item encontrado com os filtros atuais.
          </CardContent>
        </Card>
      ) : (
        <div ref={listRef} className="flex flex-col gap-2">
          {itensExibidos.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => setSelecionado(item)}
              style={{ borderLeftColor: corUrgencia(item), borderLeftWidth: 4 }}
              className="fila-item flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left opacity-0 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <ProvedorBadge provedor={item.provedor} />
                  {item.kind === "os" ? (
                    <StatusBadge status={item.status} />
                  ) : (
                    <span className="rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-xs text-muted-foreground">
                      Ocorrência · {item.status ?? "—"}
                    </span>
                  )}
                  <ContratoStatusBadge status={item.contratoStatus} />
                  <span className="text-xs text-muted-foreground">
                    {item.kind === "os" ? item.tipoDescricao ?? "OS " + item.sgpOsId : "Nº " + item.sgpNumero}
                  </span>
                </div>
                <p className="truncate text-sm font-medium text-foreground">
                  {item.kind === "os" ? item.clienteNome ?? "Cliente não identificado" : item.conteudo ?? "—"}
                </p>
                {(item.kind === "os" ? item.endereco.logradouro : null) ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {(item as Extract<FilaItem, { kind: "os" }>).endereco.logradouro},{" "}
                    {(item as Extract<FilaItem, { kind: "os" }>).endereco.numero} —{" "}
                    {(item as Extract<FilaItem, { kind: "os" }>).endereco.bairro}
                  </p>
                ) : (
                  item.pop && <p className="truncate text-xs text-muted-foreground">Localização (POP): {item.pop}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1 text-xs text-muted-foreground sm:items-end">
                {item.kind === "os" && <SlaBadge sla={item.sla} />}
                {item.kind === "os" && item.tecnicoNome && <span>Técnico: {item.tecnicoNome}</span>}
                {item.dataAgendamento && <span>{new Date(item.dataAgendamento).toLocaleString("pt-BR")}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {selecionado && selecionado.kind === "os" && (
        <OrdemServicoDetailDialog
          item={selecionado}
          onClose={() => setSelecionado(null)}
          onAtualizado={() => {
            setSelecionado(null);
            void carregar();
          }}
        />
      )}
      {selecionado && selecionado.kind === "ocorrencia" && (
        <OcorrenciaDetailDialog item={selecionado} onClose={() => setSelecionado(null)} />
      )}
    </AppShell>
  );
}
