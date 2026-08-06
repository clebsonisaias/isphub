import { formatarMoeda, paraCentavos } from "@isphub/shared";

export interface BarraValor {
  id: string;
  rotulo: string;
  /** Cor propria do item (categoria/provedor). */
  cor?: string | null;
  /** Dinheiro, string. */
  valor: string;
  /** Linha secundaria opcional (ex.: "3 lançamentos · 45 dias"). */
  detalhe?: string;
}

/**
 * Barras horizontais ranqueadas por VALOR.
 *
 * Irma do `RankedBars` do Dashboard, que ranqueia por CONTAGEM de OS. Nao
 * reusei aquele: ele tem duas series fixas (abertas/concluidas) e numero
 * inteiro no rotulo — encaixar dinheiro ali significaria um terceiro modo
 * dentro de um componente que ja serve quatro telas. Duas coisas parecidas com
 * regras diferentes; separadas, cada uma continua legivel.
 */
export function BarrasValor({ itens, vazio = "Nada a mostrar." }: { itens: BarraValor[]; vazio?: string }) {
  if (itens.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{vazio}</p>;
  }

  const ranqueados = [...itens].sort((a, b) => paraCentavos(b.valor) - paraCentavos(a.valor));
  const teto = Math.max(1, ...ranqueados.map((i) => paraCentavos(i.valor)));

  return (
    <ul className="flex flex-col gap-3">
      {ranqueados.map((item) => {
        const centavos = paraCentavos(item.valor);
        // Piso de 2%: uma barra de largura zero le como "sem valor", e o item
        // esta na lista justamente porque tem valor.
        const largura = centavos > 0 ? Math.max(2, Math.round((centavos / teto) * 100)) : 0;
        return (
          <li key={item.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{item.rotulo}</span>
              <span className="shrink-0 font-mono font-medium tabular-nums">{formatarMoeda(item.valor)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${largura}%`, backgroundColor: item.cor ?? "var(--primary)" }}
              />
            </div>
            {item.detalhe && <span className="text-xs text-muted-foreground">{item.detalhe}</span>}
          </li>
        );
      })}
    </ul>
  );
}
