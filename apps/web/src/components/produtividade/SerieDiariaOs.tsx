interface Ponto {
  dia: string;
  concluidas: number;
  pontos: number;
}

function diaCurto(dia: string): string {
  const [, mes, d] = dia.split("-");
  return `${d}/${mes}`;
}

/**
 * OS concluidas por dia, com os PONTOS por cima.
 *
 * As duas series juntas, e nao so a contagem, porque a diferenca entre elas e a
 * informacao: um dia de quatro instalacoes tem barra curta e marca alta, e e
 * exatamente esse dia que a contagem sozinha faria parecer fraco.
 *
 * Escalas independentes de proposito — OS e pontos nao sao a mesma grandeza, e
 * forcar um eixo comum faria a serie menor virar uma linha rente ao chao. O que
 * se le aqui e a FORMA de cada uma, e onde as duas discordam.
 */
export function SerieDiariaOs({ pontos }: { pontos: Ponto[] }) {
  const tetoOs = Math.max(1, ...pontos.map((p) => p.concluidas));
  const tetoPts = Math.max(1, ...pontos.map((p) => p.pontos));
  const totalOs = pontos.reduce((s, p) => s + p.concluidas, 0);

  if (pontos.length === 0 || totalOs === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma OS concluída no período.</p>;
  }

  return (
    <div>
      <div
        className="flex items-end gap-px overflow-x-auto pb-1"
        role="img"
        aria-label={`Concluídas por dia: ${totalOs} OS no período`}
      >
        {pontos.map((p) => {
          const altura = p.concluidas > 0 ? Math.max(2, Math.round((p.concluidas / tetoOs) * 100)) : 0;
          const alturaPts = p.pontos > 0 ? Math.max(2, Math.round((p.pontos / tetoPts) * 100)) : 0;
          return (
            <div key={p.dia} className="flex min-w-[8px] flex-1 flex-col items-center">
              <div className="relative flex h-28 w-full items-end">
                <div
                  className="w-full rounded-t-[2px] bg-primary/60"
                  style={{ height: `${altura}%` }}
                  title={`${diaCurto(p.dia)} · ${p.concluidas} OS · ${p.pontos.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pts`}
                />
                {/*
                  A marca dos pontos: um tracinho, e nao uma segunda barra. Duas
                  barras lado a lado convidariam a compara-las diretamente, e
                  elas estao em escalas diferentes.
                */}
                {alturaPts > 0 && (
                  <span
                    className="pointer-events-none absolute left-0 h-px w-full bg-accent-green"
                    style={{ bottom: `${alturaPts}%` }}
                    aria-hidden
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{diaCurto(pontos[0]!.dia)}</span>
        <span className="tabular-nums">{totalOs.toLocaleString("pt-BR")} OS no período</span>
        <span>{diaCurto(pontos[pontos.length - 1]!.dia)}</span>
      </div>

      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary/60" aria-hidden />
          OS concluídas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-3 bg-accent-green" aria-hidden />
          Pontos
        </span>
      </div>

      {/* Para quem nao le o grafico. So os dias com movimento. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Ver como tabela
        </summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">Dia</th>
              <th className="py-1.5 text-right font-medium">OS</th>
              <th className="py-1.5 text-right font-medium">Pontos</th>
            </tr>
          </thead>
          <tbody>
            {pontos
              .filter((p) => p.concluidas > 0)
              .map((p) => (
                <tr key={p.dia} className="border-b border-border/50">
                  <td className="py-1.5">{diaCurto(p.dia)}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.concluidas}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {p.pontos.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
