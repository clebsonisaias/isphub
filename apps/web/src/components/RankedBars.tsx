import type { ReactNode } from "react";

export interface RankedBarItem {
  id: string;
  nome: ReactNode;
  /** Cor propria da entidade (provedor/categoria) — quando ausente, usa o indigo da marca. */
  cor?: string | null;
  abertas: number;
  concluidas: number;
}

/**
 * Barras horizontais RANQUEADAS (maior primeiro) — substitui a tabela+meter
 * densa por uma leitura de painel: barra empilhada (abertas na cor da
 * entidade, concluidas em verde), rotulo e numeros junto. Reusado em
 * Por provedor / Por categoria / Por tecnico / Retiradas por provedor.
 */
export function RankedBars({ itens }: { itens: RankedBarItem[] }) {
  const ranqueados = [...itens].sort((a, b) => b.abertas + b.concluidas - (a.abertas + a.concluidas));
  const max = Math.max(1, ...ranqueados.map((i) => i.abertas + i.concluidas));

  return (
    <div className="flex flex-col gap-3.5">
      {ranqueados.map((item) => {
        const corAbertas = item.cor ?? "var(--primary)";
        const pctAbertas = Math.max(item.abertas > 0 ? 2 : 0, Math.round((item.abertas / max) * 100));
        const pctConcluidas = Math.max(item.concluidas > 0 ? 2 : 0, Math.round((item.concluidas / max) * 100));
        return (
          <div key={item.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                {item.cor && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.cor }} />}
                <span className="truncate">{item.nome}</span>
              </span>
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{item.abertas}</span> abertas · {item.concluidas} concluídas
              </span>
            </div>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pctAbertas}%`, backgroundColor: corAbertas }}
              />
              <div
                className="h-full rounded-full bg-accent-green transition-all"
                style={{ width: `${pctConcluidas}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
