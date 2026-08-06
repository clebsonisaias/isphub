import { formatarMesCurto, formatarMoeda, paraCentavos, type SerieMensalPonto } from "@isphub/shared";
import { cn } from "@/lib/utils";

/**
 * Receita x despesa mes a mes, em barras pareadas.
 *
 * CSS puro, sem biblioteca de grafico — e a mesma escolha do RankedBars e do
 * StatusDonut, que ja resolvem o painel do Dashboard. Puxar `recharts` por duas
 * series de doze pontos custaria mais no bundle do que a tela inteira.
 *
 * A altura das barras e calculada em CENTAVOS INTEIROS. Parece exagero num
 * grafico (um pixel a mais nao quebra nada), mas o valor vem como string do
 * servidor e converter pra number aqui abriria uma porta que o resto do modulo
 * mantem fechada — a proxima pessoa copiaria o `Number()` daqui pra um lugar
 * onde ele importa.
 */
export function SerieMensalChart({ pontos }: { pontos: SerieMensalPonto[] }) {
  const teto = Math.max(
    1,
    ...pontos.map((p) => Math.max(paraCentavos(p.receita), paraCentavos(p.despesa))),
  );

  const semMovimento = pontos.every(
    (p) => paraCentavos(p.receita) === 0 && paraCentavos(p.despesa) === 0,
  );

  if (semMovimento) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nenhum movimento no período.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto pb-2" role="img" aria-label="Receita e despesa por mês">
        {pontos.map((p) => {
          const receita = paraCentavos(p.receita);
          const despesa = paraCentavos(p.despesa);
          // `Math.max(…, 2)` quando ha valor: uma barra de 0,3% seria invisivel,
          // e "invisivel" le como "zero", que e outra coisa.
          const altReceita = receita > 0 ? Math.max(2, Math.round((receita / teto) * 100)) : 0;
          const altDespesa = despesa > 0 ? Math.max(2, Math.round((despesa / teto) * 100)) : 0;

          return (
            <div key={p.mes} className="flex min-w-[38px] flex-1 flex-col items-center gap-1">
              <div className="flex h-32 w-full items-end justify-center gap-0.5">
                <div
                  className="w-1/2 rounded-t-sm bg-success/80"
                  style={{ height: `${altReceita}%` }}
                  title={`${formatarMesCurto(p.mes)} · receita ${formatarMoeda(p.receita)}`}
                />
                <div
                  className="w-1/2 rounded-t-sm bg-destructive/70"
                  style={{ height: `${altDespesa}%` }}
                  title={`${formatarMesCurto(p.mes)} · despesa ${formatarMoeda(p.despesa)}`}
                />
              </div>
              <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                {formatarMesCurto(p.mes)}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap font-mono text-[10px] tabular-nums",
                  paraCentavos(p.resultado) < 0 ? "text-destructive" : "text-muted-foreground",
                )}
                title={`Resultado de ${formatarMesCurto(p.mes)}`}
              >
                {formatarMoeda(p.resultado)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success/80" aria-hidden />
          Receita
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-destructive/70" aria-hidden />
          Despesa
        </span>
      </div>

      {/*
        A tabela existe pra quem NAO consegue ler o grafico: leitor de tela,
        impressao em preto e branco, daltonismo. Barra colorida sozinha e o
        exemplo classico de informacao so na cor.
      */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Ver como tabela
        </summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">Mês</th>
              <th className="py-1.5 text-right font-medium">Receita</th>
              <th className="py-1.5 text-right font-medium">Despesa</th>
              <th className="py-1.5 text-right font-medium">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {pontos.map((p) => (
              <tr key={p.mes} className="border-b border-border/50">
                <td className="py-1.5">{formatarMesCurto(p.mes)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{formatarMoeda(p.receita)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{formatarMoeda(p.despesa)}</td>
                <td
                  className={cn(
                    "py-1.5 text-right font-mono tabular-nums",
                    paraCentavos(p.resultado) < 0 && "text-destructive",
                  )}
                >
                  {formatarMoeda(p.resultado)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
