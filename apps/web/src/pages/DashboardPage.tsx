import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardMetrics } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CountUp } from "@/components/CountUp";
import { MiniMeter } from "@/components/MiniMeter";
import { StatusBadge } from "@/components/StatusBadge";
import { dashboardApi } from "@/lib/dashboardApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { iconeCategoria } from "@/lib/categoriaIcons";
import { ArrowRight, PackageX } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/** Stat tile: label + valor grande com count-up. Cor reservada para leitura de estado (ok/critico). */
function StatTile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "critico" }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <CountUp
          value={value}
          className={`mt-1 block text-3xl font-semibold ${tone === "critico" && value > 0 ? "text-destructive" : "text-foreground"}`}
        />
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    dashboardApi
      .metrics()
      .then(setMetrics)
      .catch((err) => toast({ titulo: "Erro ao carregar métricas", descricao: mensagem(err), variante: "erro" }))
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </AppShell>
    );
  }

  if (!metrics) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Não foi possível carregar as métricas.</p>
      </AppShell>
    );
  }

  const maxProvedor = Math.max(1, ...metrics.porProvedor.map((p) => p.abertas + p.concluidas));
  const maxTecnico = Math.max(1, ...metrics.porTecnico.map((t) => t.abertas + t.concluidas));
  const maxStatus = Math.max(1, ...metrics.porStatus.map((s) => s.total));
  const maxCategoria = Math.max(1, ...metrics.porCategoria.map((c) => c.abertas + c.concluidas));
  const maxRetiradaProvedor = Math.max(1, ...metrics.retiradas.porProvedor.map((p) => p.abertas + p.concluidas));

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral da operação em todos os provedores — retiradas contam à parte.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="OS abertas" value={metrics.totalAbertas} />
        <StatTile label="OS concluídas" value={metrics.totalConcluidas} />
        <StatTile label="SLA estourado" value={metrics.slaEstourado} tone="critico" />
        <StatTile label="Provedores" value={metrics.porProvedor.length} />
      </div>

      {/* Retiradas/cancelamentos ficam separadas: sao executadas por equipe de
          fora, entao nao entram nos numeros da operacao acima. */}
      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PackageX className="size-4 text-muted-foreground" />
              Retiradas / cancelamentos
            </CardTitle>
            <CardDescription>Executadas por equipes de fora — não entram nos números acima.</CardDescription>
          </div>
          <Link
            to="/retiradas"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Ver fila de retiradas
            <ArrowRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">A retirar</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{metrics.retiradas.abertas}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Concluídas</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{metrics.retiradas.concluidas}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fora do prazo</p>
              <p
                className={`mt-1 text-2xl font-semibold ${metrics.retiradas.slaEstourado > 0 ? "text-destructive" : "text-foreground"}`}
              >
                {metrics.retiradas.slaEstourado}
              </p>
            </div>
          </div>
          {metrics.retiradas.porProvedor.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma retirada registrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provedor</TableHead>
                  <TableHead>A retirar</TableHead>
                  <TableHead>Concluídas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.retiradas.porProvedor.map((p) => (
                  <TableRow key={p.provedorId}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: p.cor }} />
                        {p.provedorNome}
                      </span>
                    </TableCell>
                    <TableCell className="w-32">
                      <div className="flex items-center gap-2">
                        <span className="w-6 text-right tabular-nums">{p.abertas}</span>
                        <MiniMeter value={p.abertas} max={maxRetiradaProvedor} colorClassName="bg-primary" />
                      </div>
                    </TableCell>
                    <TableCell className="w-32">
                      <div className="flex items-center gap-2">
                        <span className="w-6 text-right tabular-nums">{p.concluidas}</span>
                        <MiniMeter value={p.concluidas} max={maxRetiradaProvedor} colorClassName="bg-success" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Por provedor</CardTitle>
            <CardDescription>OS abertas e concluídas em cada provedor atendido.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.porProvedor.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provedor</TableHead>
                    <TableHead>Abertas</TableHead>
                    <TableHead>Concluídas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.porProvedor.map((p) => (
                    <TableRow key={p.provedorId}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: p.cor }} />
                          {p.provedorNome}
                        </span>
                      </TableCell>
                      <TableCell className="w-32">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-right tabular-nums">{p.abertas}</span>
                          <MiniMeter value={p.abertas} max={maxProvedor} colorClassName="bg-primary" />
                        </div>
                      </TableCell>
                      <TableCell className="w-32">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-right tabular-nums">{p.concluidas}</span>
                          <MiniMeter value={p.concluidas} max={maxProvedor} colorClassName="bg-success" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por status</CardTitle>
            <CardDescription>Distribuição das OS por status atual.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.porStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {metrics.porStatus.map((s) => (
                  <div key={s.status} className="flex items-center gap-3">
                    <div className="w-28 shrink-0">
                      <StatusBadge status={s.status} />
                    </div>
                    <MiniMeter value={s.total} max={maxStatus} colorClassName="bg-primary" />
                    <span className="w-8 text-right text-sm tabular-nums text-muted-foreground">{s.total}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por categoria</CardTitle>
            <CardDescription>OS abertas e concluídas por categoria canônica da ISPhub.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.porCategoria.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Abertas</TableHead>
                    <TableHead>Concluídas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.porCategoria.map((c) => {
                    const Icone = iconeCategoria(c.icone);
                    return (
                      <TableRow key={c.categoriaId ?? "sem_categoria"}>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5" style={{ color: c.categoriaId ? c.cor : undefined }}>
                            <Icone className="size-3.5" />
                            <span className={c.categoriaId ? "text-foreground" : "text-muted-foreground"}>{c.nome}</span>
                          </span>
                        </TableCell>
                        <TableCell className="w-32">
                          <div className="flex items-center gap-2">
                            <span className="w-6 text-right tabular-nums">{c.abertas}</span>
                            <MiniMeter value={c.abertas} max={maxCategoria} colorClassName="bg-primary" />
                          </div>
                        </TableCell>
                        <TableCell className="w-32">
                          <div className="flex items-center gap-2">
                            <span className="w-6 text-right tabular-nums">{c.concluidas}</span>
                            <MiniMeter value={c.concluidas} max={maxCategoria} colorClassName="bg-success" />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Por técnico</CardTitle>
            <CardDescription>Carga de trabalho de cada técnico, em todos os provedores.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.porTecnico.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma OS atribuída ainda.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Técnico</TableHead>
                    <TableHead>Abertas</TableHead>
                    <TableHead>Concluídas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.porTecnico.map((t) => (
                    <TableRow key={t.tecnicoId}>
                      <TableCell>{t.tecnicoNome}</TableCell>
                      <TableCell className="w-32">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-right tabular-nums">{t.abertas}</span>
                          <MiniMeter value={t.abertas} max={maxTecnico} colorClassName="bg-primary" />
                        </div>
                      </TableCell>
                      <TableCell className="w-32">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-right tabular-nums">{t.concluidas}</span>
                          <MiniMeter value={t.concluidas} max={maxTecnico} colorClassName="bg-success" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
