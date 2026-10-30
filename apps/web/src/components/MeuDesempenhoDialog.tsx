import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { meuDesempenhoApi, type MeuDesempenhoDto } from "@/lib/meuDesempenhoApi";
import {
  Trophy,
  Medal,
  Crown,
  Star,
  Zap,
  Target,
  Clock,
  CheckCircle2,
  Lock,
  Loader2,
  Users,
  User,
  Sparkles,
} from "lucide-react";

export function MeuDesempenhoDialog({
  aberto,
  onFechar,
}: {
  aberto: boolean;
  onFechar: () => void;
  tecnicoId?: string;
}) {
  const [periodo, setPeriodo] = useState<"semana" | "mes">("mes");
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState<MeuDesempenhoDto | null>(null);

  useEffect(() => {
    if (!aberto) return;
    let ativo = true;
    setCarregando(true);
    meuDesempenhoApi
      .obter(periodo)
      .then((res) => {
        if (ativo) setDados(res);
      })
      .catch((err) => {
        console.warn("[MeuDesempenhoDialog] Falha ao carregar desempenho:", err);
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [aberto, periodo]);

  const posicao = dados?.ranking.posicao ?? 1;
  const total = dados?.ranking.totalTecnicos ?? 1;
  const meusPontos = dados?.pessoal.pontos ?? 0;
  const diferencaLider = dados?.ranking.diferencaParaLider ?? 0;

  // Ícone e cores de destaque conforme o ranking
  const medalhaIcon =
    posicao === 1 ? (
      <Crown className="size-8 text-amber-400 animate-bounce" />
    ) : posicao === 2 ? (
      <Medal className="size-8 text-slate-300" />
    ) : posicao === 3 ? (
      <Medal className="size-8 text-amber-600" />
    ) : (
      <Trophy className="size-8 text-primary" />
    );

  const corCardDestaque =
    posicao === 1
      ? "from-amber-500/20 via-amber-500/10 to-transparent border-amber-500/40 text-amber-600 dark:text-amber-300"
      : posicao === 2
        ? "from-slate-400/20 via-slate-400/10 to-transparent border-slate-400/40 text-slate-700 dark:text-slate-300"
        : posicao === 3
          ? "from-amber-700/20 via-amber-700/10 to-transparent border-amber-700/40 text-amber-700 dark:text-amber-400"
          : "from-primary/20 via-primary/10 to-transparent border-primary/30 text-primary";

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg overflow-hidden p-0 sm:max-w-xl">
        {/* Cabeçalho com abas */}
        <div className="min-w-0 border-b border-border bg-secondary/30 p-4 pr-12 sm:p-5 sm:pr-12">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <DialogHeader className="min-w-0 pr-0 text-left">
              <div className="flex items-center gap-2">
                <Trophy className="size-5 shrink-0 text-amber-500" />
                <DialogTitle className="text-base font-bold sm:text-lg">Meu Desempenho & Ranking</DialogTitle>
                {carregando && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
              </div>
              <DialogDescription className="text-xs">
                Sua pontuação individual, metas e qualidade no ISPhub + SGP
              </DialogDescription>
            </DialogHeader>

            <div className="flex shrink-0 rounded-lg border border-border bg-background p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setPeriodo("semana")}
                className={`rounded-md px-3 py-1.5 min-h-9 text-xs font-bold transition-colors ${
                  periodo === "semana" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => setPeriodo("mes")}
                className={`rounded-md px-3 py-1.5 min-h-9 text-xs font-bold transition-colors ${
                  periodo === "mes" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Mês
              </button>
            </div>
          </div>
        </div>

        <div className="min-w-0 max-h-[75vh] overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Card Principal: Posição no Ranking & Pontuação (Privado) */}
          <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 sm:p-5 ${corCardDestaque}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-block rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase backdrop-blur-sm shadow-xs">
                    {dados?.ranking.titulo ?? "Técnico NetGO"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                    <Sparkles className="size-3" />
                    {meusPontos % 1 === 0 ? meusPontos : meusPontos.toFixed(1)} pts
                  </span>
                </div>

                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold sm:text-4xl">
                    #{posicao}
                  </span>
                  <span className="text-sm font-medium opacity-80">
                    lugar de {total} técnicos da equipe
                  </span>
                </div>

                {/* Status em relação ao líder */}
                <p className="text-xs font-normal opacity-90 pt-0.5">
                  {posicao === 1 && meusPontos > 0 ? (
                    "🏆 Parabéns! Você é o líder geral de produtividade no período."
                  ) : diferencaLider > 0 ? (
                    <>
                      Faltam apenas <strong>{diferencaLider % 1 === 0 ? diferencaLider : diferencaLider.toFixed(1)} pts</strong> para você assumir o 1º lugar!
                    </>
                  ) : (
                    "Excelente desempenho! Continue pontuando para subir no pódio."
                  )}
                </p>

                {/* Subdetalhe de regras de pontuação */}
                <div className="flex flex-wrap gap-1.5 pt-1 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded bg-background/60 px-2 py-0.5 font-medium shadow-2xs backdrop-blur-xs">
                    <User className="size-3 text-emerald-500" />
                    {dados?.pessoal.osIndividual ?? 0} individuais (+{(dados?.pessoal.osIndividual ?? 0) * 1} pt)
                  </span>
                  <span className="inline-flex items-center gap-1 rounded bg-background/60 px-2 py-0.5 font-medium shadow-2xs backdrop-blur-xs">
                    <Users className="size-3 text-blue-500" />
                    {dados?.pessoal.osDupla ?? 0} em dupla (+{((dados?.pessoal.osDupla ?? 0) * 0.5).toFixed(1)} pt)
                  </span>
                </div>
              </div>

              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-background/60 shadow-inner backdrop-blur-sm sm:size-16">
                {medalhaIcon}
              </div>
            </div>

            {/* Barra de Progresso da Meta do Período */}
            <div className="mt-4 pt-3 border-t border-current/10">
              <div className="flex items-center justify-between text-xs font-semibold mb-1">
                <span>Meta ({dados?.pessoal.metaSemanal ?? 25} pontos)</span>
                <span>{dados?.pessoal.progressoMetaPct ?? 0}%</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-background/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-current transition-all duration-700"
                  style={{ width: `${dados?.pessoal.progressoMetaPct ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* Grid de Métricas Pessoais */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-3 shadow-soft-sm">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-primary" />
                <span>Total de O.S.</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-foreground">
                  {dados?.pessoal.osConcluidas ?? 0}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  (Média: {dados?.benchmarksEquipe.mediaEquipeOs ?? 0})
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {periodo === "semana" ? `Mês: ${dados?.pessoal.osConcluidasMes ?? 0} OS` : `Semana: ${dados?.pessoal.osConcluidasSemana ?? 0} OS`}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-3 shadow-soft-sm">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5 text-amber-500" />
                <span>Tempo Médio</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-foreground">
                  {dados?.pessoal.tempoMedioMinutos ? `${dados.pessoal.tempoMedioMinutos}m` : "—"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  (Média: {dados?.benchmarksEquipe.tempoMedioEquipeMin ?? 45}m)
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Tempo do início à conclusão
              </p>
            </div>

            <div className="col-span-2 sm:col-span-1 rounded-xl border border-border bg-card p-3 shadow-soft-sm">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                <span>Nota dos Clientes</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-foreground">
                  {dados?.pessoal.notaMedia ? `${dados.pessoal.notaMedia}` : "5.0"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  ⭐ ({dados?.pessoal.totalAvaliacoes ?? 0} aval.)
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Pesquisa pós-atendimento
              </p>
            </div>
          </div>

          {/* Banner explicativo das regras de pontos */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-foreground/80 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Target className="size-4 text-primary shrink-0" />
              <span>
                <strong>Regra de Pontuação:</strong> O.S. individual = <strong>1,0 ponto</strong> | O.S. duplada (em dupla) = <strong>0,5 ponto</strong> para cada técnico.
              </span>
            </div>
          </div>

          {/* Insígnias & Conquistas */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-soft-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Suas Conquistas
              </span>
              <span className="text-xs text-muted-foreground">
                {dados?.insignias.filter((i) => i.desbloqueada).length ?? 0} de {dados?.insignias.length ?? 5}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {dados?.insignias.map((insignia) => {
                const Icone =
                  insignia.icone === "crown"
                    ? Crown
                    : insignia.icone === "medal"
                      ? Medal
                      : insignia.icone === "star"
                        ? Star
                        : insignia.icone === "zap"
                          ? Zap
                          : Target;

                return (
                  <div
                    key={insignia.id}
                    className={`flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
                      insignia.desbloqueada
                        ? "border-amber-500/30 bg-amber-500/5 text-foreground"
                        : "border-border/50 bg-secondary/20 text-muted-foreground opacity-60"
                    }`}
                  >
                    <div
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                        insignia.desbloqueada
                          ? "bg-amber-500/20 text-amber-500 font-bold"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {insignia.desbloqueada ? (
                        <Icone className="size-4.5" />
                      ) : (
                        <Lock className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight">{insignia.nome}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                        {insignia.descricao}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Nota de Privacidade Estrita */}
          <p className="text-center text-[11px] text-muted-foreground">
            🔒 <em>Classificação individual e anônima. Cada técnico visualiza exclusivamente seu próprio rendimento e pontuação.</em>
          </p>
        </div>

        <div className="border-t border-border bg-secondary/20 p-3 sm:p-4 flex justify-end">
          <Button variant="outline" size="default" className="min-h-11 font-semibold w-full sm:w-auto px-6" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
