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
} from "lucide-react";

export function MeuDesempenhoDialog({
  aberto,
  onFechar,
}: {
  aberto: boolean;
  onFechar: () => void;
}) {
  const [periodo, setPeriodo] = useState<"semana" | "mes">("semana");
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
        <div className="border-b border-border bg-secondary/30 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <DialogHeader className="text-left">
              <div className="flex items-center gap-2">
                <Trophy className="size-5 text-amber-500" />
                <DialogTitle className="text-lg font-bold">Meu Desempenho</DialogTitle>
                {carregando && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              </div>
              <DialogDescription className="text-xs">
                Seu ranking pessoal, metas e qualidade de atendimento
              </DialogDescription>
            </DialogHeader>

            <div className="flex rounded-lg border border-border bg-background p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setPeriodo("semana")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  periodo === "semana" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => setPeriodo("mes")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  periodo === "mes" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Mês
              </button>
            </div>
          </div>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Card Principal: Posição no Ranking (Privado) */}
          <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 sm:p-5 ${corCardDestaque}`}>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="inline-block rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase backdrop-blur-sm shadow-xs">
                  {dados?.ranking.titulo ?? "Técnico NetGO"}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold sm:text-4xl">
                    #{posicao}
                  </span>
                  <span className="text-sm font-medium opacity-80">
                    lugar de {total} técnicos
                  </span>
                </div>
                <p className="text-xs font-normal opacity-90">
                  {posicao === 1 ? (
                    "Parabéns! Você está na liderança da equipe no período."
                  ) : (
                    <>
                      {dados?.ranking.diferencaParaLider
                        ? `Faltam apenas ${dados.ranking.diferencaParaLider} O.S. para você assumir o 1º lugar!`
                        : "Ótimo ritmo de atendimento. Continue assim!"}
                    </>
                  )}
                </p>
              </div>

              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-background/60 shadow-inner backdrop-blur-sm sm:size-16">
                {medalhaIcon}
              </div>
            </div>

            {/* Barra de Progresso da Meta */}
            <div className="mt-4 pt-3 border-t border-current/10">
              <div className="flex items-center justify-between text-xs font-semibold mb-1">
                <span>Meta do Período ({dados?.pessoal.metaSemanal ?? 25} O.S.)</span>
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
                <span>O.S. Concluídas</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">
                  {dados?.pessoal.osConcluidas ?? 0}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  (Média: {dados?.benchmarksEquipe.mediaEquipeOs ?? 0})
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-3 shadow-soft-sm">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5 text-amber-500" />
                <span>Tempo Médio</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">
                  {dados?.pessoal.tempoMedioMinutos ? `${dados.pessoal.tempoMedioMinutos}m` : "—"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  (Média: {dados?.benchmarksEquipe.tempoMedioEquipeMin ?? 45}m)
                </span>
              </div>
            </div>

            <div className="col-span-2 sm:col-span-1 rounded-xl border border-border bg-card p-3 shadow-soft-sm">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                <span>Nota dos Clientes</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">
                  {dados?.pessoal.notaMedia ? `${dados.pessoal.notaMedia}` : "5.0"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  ⭐ ({dados?.pessoal.totalAvaliacoes ?? 0} {dados?.pessoal.totalAvaliacoes === 1 ? "avaliação" : "avaliações"})
                </span>
              </div>
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

          {/* Nota de Privacidade */}
          <p className="text-center text-[11px] text-muted-foreground">
            🔒 <em>Classificação individual e privada. Cada técnico visualiza apenas o seu próprio rendimento.</em>
          </p>
        </div>

        <div className="border-t border-border bg-secondary/20 p-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
