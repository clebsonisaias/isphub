import { useQuery } from "@tanstack/react-query";
import { Award, CalendarCheck, Flame, Lock, PlugZap, Rocket, Star, Target, Trophy, Wifi, type LucideIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { ApiError } from "@/lib/apiClient";
import { producaoVendedorApi, type ProducaoVendedor } from "@/lib/producaoVendedorApi";
import { cn } from "@/lib/utils";

/**
 * MEU MES — a producao da vendedora, com cara de jogo: o numero de vendas grande,
 * a meta enchendo, o nivel (medalha), a sequencia de dias, a posicao entre os
 * colegas (privada: so a dela) e as conquistas. Abre no celular, na rua.
 */

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Cor da medalha por nivel — o unico lugar com cor fora do roxo da marca. */
const MEDALHA: Record<string, string> = {
  Bronze: "from-[#b87333] to-[#e0a066]",
  Prata: "from-[#8a94a6] to-[#d5dbe5]",
  Ouro: "from-[#d4a017] to-[#f5d76e]",
  Diamante: "from-[#5b3fe0] to-[#a78bfa]",
};

const ICONE_CONQUISTA: Record<string, LucideIcon> = {
  primeira: Star,
  instalada: PlugZap,
  na_hora: CalendarCheck,
  dia_cheio: Rocket,
  sequencia: Flame,
  dezena: Award,
  meta: Trophy,
};

const ordinal = (n: number) => `${n}º`;

export function ProducaoVendedorPage() {
  const q = useQuery({ queryKey: ["producao-vendedor"], queryFn: () => producaoVendedorApi.obter(), refetchInterval: 5 * 60_000 });

  return (
    <AppShell>
      <AnimatedPage>
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <header className="flex flex-col gap-1">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Minha produção</p>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Meu mês{q.data ? <span className="text-muted-foreground"> · {MESES[Number(q.data.mes.slice(5, 7)) - 1]}</span> : null}
            </h1>
          </header>
          {q.isPending ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-44 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
            </div>
          ) : q.isError ? (
            <ErrorState
              message={q.error instanceof ApiError ? q.error.message : "Não consegui carregar sua produção. Confira o sinal e tente de novo."}
              onRetry={() => void q.refetch()}
            />
          ) : (
            <Painel p={q.data} />
          )}
        </div>
      </AnimatedPage>
    </AppShell>
  );
}

function Painel({ p }: { p: ProducaoVendedor }) {
  return (
    <>
      {/* O placar: vendas do mes, meta e nivel. */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#2a1f5c] via-[#3b2a85] to-[#5b3fe0] p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white/75">Vendas no mês</p>
            <p className="font-display text-6xl font-extrabold leading-none tracking-tight tabular-nums">{p.vendasMes}</p>
            <p className="mt-1 text-sm text-white/80">
              {p.faltamParaMeta > 0 ? (
                <>
                  Faltam <b className="text-white">{p.faltamParaMeta}</b> para a meta de {p.meta}
                </>
              ) : (
                <b className="text-white">Meta de {p.meta} batida!</b>
              )}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span
              className={cn("grid size-16 place-items-center rounded-full bg-gradient-to-br shadow-md ring-4 ring-white/20", MEDALHA[p.nivel.atual] ?? MEDALHA.Bronze)}
              aria-hidden
            >
              <Award className="size-8 text-white drop-shadow" />
            </span>
            <span className="text-sm font-bold">{p.nivel.atual}</span>
          </div>
        </div>
        <div className="mt-4">
          <div className="h-3 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.progressoMeta} aria-label="Progresso da meta do mês">
            <div className="h-full rounded-full bg-gradient-to-r from-[#c9bcff] to-white transition-[width] duration-700" style={{ width: `${Math.max(3, p.progressoMeta)}%` }} />
          </div>
          <p className="mt-2 flex justify-between text-xs text-white/75">
            <span>{p.progressoMeta}% da meta</span>
            {p.nivel.proximo && (
              <span>
                {p.nivel.faltamParaProximo} {p.nivel.faltamParaProximo === 1 ? "venda" : "vendas"} para {p.nivel.proximo}
              </span>
            )}
          </p>
        </div>
      </section>

      {/* Os numeros do dia a dia. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Resumo">
        <Bloco rotulo="Hoje" valor={p.vendasHoje} icone={Target} />
        <Bloco rotulo="Na semana" valor={p.vendasSemana} icone={CalendarCheck} />
        <Bloco rotulo="Instaladas" valor={p.instaladasMes} icone={PlugZap} detalhe={p.vendasMes ? `de ${p.vendasMes} ${p.vendasMes === 1 ? "venda" : "vendas"}` : undefined} />
        <Bloco rotulo="Ativas" valor={p.ativasMes} icone={Wifi} detalhe="contrato ativo" destaque />
      </section>

      {/* Sequencia e posicao. */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <span className={cn("grid size-12 place-items-center rounded-xl", p.sequenciaDias > 0 ? "bg-orange-500/15 text-orange-500" : "bg-secondary text-muted-foreground")}>
            <Flame className="size-6" />
          </span>
          <div>
            <p className="font-display text-xl font-bold tabular-nums">
              {p.sequenciaDias} {p.sequenciaDias === 1 ? "dia seguido" : "dias seguidos"}
            </p>
            <p className="text-sm text-muted-foreground">{p.sequenciaDias > 0 ? "Venda hoje para manter a sequência." : "Uma venda hoje começa a sequência."}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Trophy className="size-6" />
          </span>
          <div>
            <p className="font-display text-xl font-bold tabular-nums">
              {ordinal(p.ranking.posicao)} de {p.ranking.total}
            </p>
            <p className="text-sm text-muted-foreground">
              {p.ranking.posicao === 1
                ? "Você lidera o mês. Segure a ponta!"
                : `Faltam ${p.ranking.faltamParaLider} ${p.ranking.faltamParaLider === 1 ? "venda" : "vendas"} para o 1º lugar.`}
            </p>
          </div>
        </div>
      </section>

      <MesEmBarras porDia={p.porDia} />

      {/* Conquistas. */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold">Conquistas</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {p.conquistas.map((c) => {
            const Icone = ICONE_CONQUISTA[c.id] ?? Star;
            return (
              <li
                key={c.id}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center",
                  c.desbloqueada ? "border-primary/40 bg-primary/5" : "border-border bg-card opacity-60",
                )}
              >
                <span className={cn("grid size-11 place-items-center rounded-full", c.desbloqueada ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>
                  {c.desbloqueada ? <Icone className="size-5" /> : <Lock className="size-4" />}
                </span>
                <span className="text-sm font-semibold leading-tight">{c.nome}</span>
                <span className="text-xs leading-snug text-muted-foreground">{c.descricao}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="pb-2 text-xs text-muted-foreground">
        {p.taxaAgendadaNaHora}% das suas vendas do mês saíram com a instalação agendada na hora. Instalada é a OS de instalação concluída;
        ativa é instalada e com o contrato ativo no SGP.
      </p>
    </>
  );
}

function Bloco({ rotulo, valor, icone: Icone, detalhe, destaque }: { rotulo: string; valor: number; icone: LucideIcon; detalhe?: string; destaque?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-2xl border p-4", destaque ? "border-success/40 bg-success/10" : "border-border bg-card")}>
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icone className="size-3.5" />
        {rotulo}
      </span>
      <span className="font-display text-3xl font-extrabold tabular-nums">{valor}</span>
      {detalhe && <span className="text-xs text-muted-foreground">{detalhe}</span>}
    </div>
  );
}

/** Vendas por dia do mes: uma barra por dia ate hoje, hoje em destaque. */
function MesEmBarras({ porDia }: { porDia: ProducaoVendedor["porDia"] }) {
  const max = Math.max(1, ...porDia.map((d) => d.vendas));
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4" aria-label="Vendas por dia do mês">
      <h2 className="font-display text-lg font-bold">Seu mês, dia a dia</h2>
      <div className="flex h-28 items-end gap-[3px]">
        {porDia.map((d, i) => {
          const hoje = i === porDia.length - 1;
          return (
            <div key={d.dia} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}: ${d.vendas}`}>
              <div
                className={cn("w-full rounded-t-sm", d.vendas ? (hoje ? "bg-primary" : "bg-primary/45") : "bg-border")}
                style={{ height: d.vendas ? `${Math.max(10, (d.vendas / max) * 100)}%` : "3px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>dia 1</span>
        <span>hoje</span>
      </div>
    </section>
  );
}
