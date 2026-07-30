import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { DashboardMetrics } from "@isphub/shared";
import { gsap, useGSAP, ScrollTrigger } from "@/lib/gsapSetup";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { CountUp } from "@/components/CountUp";
import { RankedBars } from "@/components/RankedBars";
import { StatusDonut } from "@/components/StatusDonut";
import { dashboardApi } from "@/lib/dashboardApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { ArrowRight, PackageX, Inbox, CheckCircle2, Building2, AlarmClock, type LucideIcon } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/**
 * Bloco de KPI colorido — a marca do "painel vivo": numero gigante em Sora,
 * fundo cheio na cor do que ele representa (indigo/verde/azul), exceto SLA
 * estourado, que so vira bloco vermelho quando > 0 (destructive e RESERVADO
 * pro sinal — aqui e literalmente o sinal, nao decoracao; em 0 fica neutro).
 *
 * `variacao`/sparkline: a API (DashboardMetrics) ainda nao expoe historico
 * (nenhuma serie temporal no tipo) — o prop existe pronto pra quando existir,
 * mas NAO e alimentado com numero inventado enquanto o backend nao tiver o
 * dado. Ver packages/shared/src/types.ts:222 (DashboardMetrics).
 */
function KpiTile({
  label,
  value,
  tone,
  icon: Icon,
  variacaoPct,
}: {
  label: string;
  value: number;
  tone: "indigo" | "green" | "blue" | "critico";
  icon: LucideIcon;
  variacaoPct?: number;
}) {
  const critico = tone === "critico";
  const emAlerta = critico && value > 0;
  const toneClasses =
    tone === "indigo"
      ? "bg-primary text-primary-foreground"
      : tone === "green"
        ? "bg-accent-green text-accent-green-foreground"
        : tone === "blue"
          ? "bg-accent-blue text-accent-blue-foreground"
          : emAlerta
            ? "border border-destructive/30 bg-destructive/10 text-destructive"
            : "border border-border bg-card text-foreground";
  const labelToneClasses = tone === "critico" ? (emAlerta ? "text-destructive/80" : "text-muted-foreground") : "opacity-85";

  return (
    <Card className={`dash-top-card overflow-hidden opacity-0 ${toneClasses}`}>
      <CardContent className="flex items-start justify-between gap-2 py-5">
        <div>
          <p className={`text-xs font-medium uppercase tracking-wide ${labelToneClasses}`}>{label}</p>
          <CountUp value={value} className="mt-1 block font-display text-4xl font-bold" />
          {variacaoPct != null && (
            <span className="mt-1 inline-block text-xs font-medium opacity-85">
              {variacaoPct >= 0 ? "▲" : "▼"} {Math.abs(variacaoPct)}% vs. período anterior
            </span>
          )}
        </div>
        <Icon className="size-5 shrink-0 opacity-70" />
      </CardContent>
    </Card>
  );
}

function SecaoVazia({ titulo }: { titulo: string }) {
  return <EmptyState title={titulo} className="py-6" />;
}

function DashboardSkeleton() {
  return (
    <AppShell>
      <div className="mb-6">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="mt-2 h-4 w-80 rounded-md" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mb-6 h-40 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-xl" />
        ))}
      </div>
    </AppShell>
  );
}

export function DashboardPage() {
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [carregando, setCarregando] = useState(true);
  const pageRef = useRef<HTMLDivElement>(null);

  function carregar() {
    setCarregando(true);
    dashboardApi
      .metrics()
      .then(setMetrics)
      .catch((err) => {
        toast({ titulo: "Erro ao carregar métricas", descricao: mensagem(err), variante: "erro" });
      })
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reveal do Dashboard: os KPIs + card de Retiradas ja estao visiveis no
  // primeiro frame (stagger simples no mount). Os cards de baixo costumam
  // ficar abaixo da dobra em telas de notebook — usam ScrollTrigger.batch
  // (sem pin/scrub, so "anima quando entra na tela", once:true) em vez de
  // reveal-on-mount, que os deixaria pular pra vista mesmo fora da tela. Por
  // isso o Dashboard NAO usa <AnimatedPage> (Bloco 1): esse reveal ligado a
  // scroll e o unico lugar do redesign onde GSAP continua sendo a ferramenta
  // certa — Framer Motion nao tem um equivalente direto a ScrollTrigger.batch.
  useGSAP(
    () => {
      if (!pageRef.current || !metrics) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(".dash-top-card, .dash-reveal-card", { opacity: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        ".dash-top-card",
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, ease: "power1.out" },
      );
      ScrollTrigger.batch(".dash-reveal-card", {
        start: "top 85%",
        once: true,
        onEnter: (elements) =>
          gsap.fromTo(
            elements,
            { opacity: 0, y: 16 },
            { opacity: 1, y: 0, duration: 0.4, stagger: 0.1, ease: "power1.out" },
          ),
      });
    },
    { scope: pageRef, dependencies: [metrics] },
  );

  if (carregando) return <DashboardSkeleton />;

  if (!metrics) {
    return (
      <AppShell>
        <ErrorState message="Não foi possível carregar as métricas." onRetry={carregar} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div ref={pageRef}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral da operação em todos os provedores — retiradas contam à parte.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile label="OS abertas" value={metrics.totalAbertas} tone="indigo" icon={Inbox} />
          <KpiTile label="OS concluídas" value={metrics.totalConcluidas} tone="green" icon={CheckCircle2} />
          <KpiTile label="Provedores" value={metrics.porProvedor.length} tone="blue" icon={Building2} />
          <KpiTile label="SLA estourado" value={metrics.slaEstourado} tone="critico" icon={AlarmClock} />
        </div>

        {/* Retiradas/cancelamentos ficam separadas: sao executadas por equipe de
            fora, entao nao entram nos numeros da operacao acima. */}
        <Card className="dash-top-card mb-6 opacity-0">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PackageX className="size-4 text-muted-foreground" />
                Retiradas / cancelamentos
              </CardTitle>
              <CardDescription>Executadas por equipes de fora — não entram nos números acima.</CardDescription>
            </div>
            <Link to="/retiradas" className="inline-flex items-center gap-1 text-sm font-medium text-primary pointer-coarse:min-h-11 hover:underline">
              Ver fila de retiradas
              <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <MiniStat label="A retirar" value={metrics.retiradas.abertas} />
              <MiniStat label="Concluídas" value={metrics.retiradas.concluidas} />
              <MiniStat label="Fora do prazo" value={metrics.retiradas.slaEstourado} critico />
            </div>
            {metrics.retiradas.porProvedor.length === 0 ? (
              <SecaoVazia titulo="Nenhuma retirada registrada" />
            ) : (
              <RankedBars
                itens={metrics.retiradas.porProvedor.map((p) => ({
                  id: p.provedorId,
                  nome: p.provedorNome,
                  cor: p.cor,
                  abertas: p.abertas,
                  concluidas: p.concluidas,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="dash-reveal-card opacity-0">
            <CardHeader>
              <CardTitle>Por provedor</CardTitle>
              <CardDescription>OS abertas e concluídas em cada provedor atendido, do maior para o menor.</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.porProvedor.length === 0 ? (
                <SecaoVazia titulo="Sem dados ainda" />
              ) : (
                <RankedBars
                  itens={metrics.porProvedor.map((p) => ({
                    id: p.provedorId,
                    nome: p.provedorNome,
                    cor: p.cor,
                    abertas: p.abertas,
                    concluidas: p.concluidas,
                  }))}
                />
              )}
            </CardContent>
          </Card>

          <Card className="dash-reveal-card opacity-0">
            <CardHeader>
              <CardTitle>Por status</CardTitle>
              <CardDescription>Distribuição das OS por status atual.</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.porStatus.length === 0 ? <SecaoVazia titulo="Sem dados ainda" /> : <StatusDonut dados={metrics.porStatus} />}
            </CardContent>
          </Card>

          <Card className="dash-reveal-card opacity-0">
            <CardHeader>
              <CardTitle>Por categoria</CardTitle>
              <CardDescription>OS abertas e concluídas por categoria canônica da ISPhub.</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.porCategoria.length === 0 ? (
                <SecaoVazia titulo="Sem dados ainda" />
              ) : (
                <RankedBars
                  itens={metrics.porCategoria.map((c) => ({
                    id: c.categoriaId ?? "sem_categoria",
                    nome: c.nome,
                    cor: c.categoriaId ? c.cor : null,
                    abertas: c.abertas,
                    concluidas: c.concluidas,
                  }))}
                />
              )}
            </CardContent>
          </Card>

          <Card className="dash-reveal-card opacity-0 lg:col-span-2">
            <CardHeader>
              <CardTitle>Por técnico</CardTitle>
              <CardDescription>Carga de trabalho de cada técnico, em todos os provedores.</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.porTecnico.length === 0 ? (
                <SecaoVazia titulo="Nenhuma OS atribuída ainda" />
              ) : (
                <RankedBars
                  itens={metrics.porTecnico.map((t) => ({
                    id: t.tecnicoId,
                    nome: t.tecnicoNome,
                    abertas: t.abertas,
                    concluidas: t.concluidas,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function MiniStat({ label, value, critico }: { label: string; value: number; critico?: boolean }): ReactNode {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${critico && value > 0 ? "text-destructive" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
