interface Ponto {
  dia: string;
  kmGps: number;
  viagens: number;
}

/** "2026-08-09" -> "09/08". Sem `new Date`: a string ja e o dia brasileiro. */
function diaCurto(dia: string): string {
  const [, mes, d] = dia.split("-");
  return `${d}/${mes}`;
}

/**
 * Quilometragem por dia — barras, CSS puro, sem biblioteca de grafico.
 *
 * Nao reusei `SerieMensalChart`: ele desenha DUAS series pareadas (receita e
 * despesa) com rotulo em dinheiro e eixo mensal. Aqui e uma serie so, em
 * quilometros, e com ate 90 colunas em vez de 12 — encaixar isso la dentro
 * viraria um terceiro modo num componente que ja serve duas telas.
 *
 * **Os dias vazios aparecem.** A serie chega do servidor com todos os dias do
 * intervalo, inclusive os de km zero, e e o que os faz caber aqui: um grafico
 * so com os dias que tiveram viagem esconde exatamente o que interessa. O dia
 * parado tem de ser uma coluna rasa, nao um buraco no eixo — buraco le como
 * "nao medimos", que e outra coisa.
 */
export function SerieDiariaKm({ pontos, totalKm }: { pontos: Ponto[]; totalKm: number }) {
  const teto = Math.max(1, ...pontos.map((p) => p.kmGps));

  if (pontos.length === 0 || totalKm === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nenhuma viagem registrada por rastreador no período.
      </p>
    );
  }

  return (
    <div>
      {/*
        `overflow-x-auto` no proprio container: 90 colunas nao cabem num celular,
        e o corpo da pagina nunca deve rolar de lado por causa de um grafico.
      */}
      <div
        className="flex items-end gap-px overflow-x-auto pb-1"
        role="img"
        aria-label={`Quilometragem diária: ${totalKm} km no período`}
      >
        {pontos.map((p) => {
          // Piso de 2% quando ha km: uma barra de 0,3% e invisivel, e invisivel
          // le como zero — que e justamente a outra coisa que o grafico separa.
          const altura = p.kmGps > 0 ? Math.max(2, Math.round((p.kmGps / teto) * 100)) : 0;
          return (
            <div key={p.dia} className="flex min-w-[6px] flex-1 flex-col items-center">
              <div className="flex h-28 w-full items-end">
                <div
                  className="w-full rounded-t-[2px] bg-primary/75"
                  style={{ height: `${altura}%` }}
                  title={`${diaCurto(p.dia)} · ${p.kmGps} km · ${p.viagens} ${p.viagens === 1 ? "viagem" : "viagens"}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{diaCurto(pontos[0]!.dia)}</span>
        {/*
          O total vem do SERVIDOR, e nao de somar as colunas. Cada coluna e um
          quilometro arredondado, e a soma de noventa arredondamentos nao bate
          com o arredondamento da soma — o rodape divergia do KPI em 4 km, que e
          exatamente o tipo de diferenca que faz um gestor parar de confiar na
          tela inteira.
        */}
        <span className="tabular-nums">{totalKm.toLocaleString("pt-BR")} km no período</span>
        <span>{diaCurto(pontos[pontos.length - 1]!.dia)}</span>
      </div>

      {/*
        Para quem NAO le o grafico: leitor de tela, impressao em preto e branco,
        daltonismo. So os dias com movimento — noventa linhas de zero seriam
        ruido, e o total acima ja diz que o resto e zero.
      */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Ver como tabela
        </summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">Dia</th>
              <th className="py-1.5 text-right font-medium">km</th>
              <th className="py-1.5 text-right font-medium">Viagens</th>
            </tr>
          </thead>
          <tbody>
            {pontos
              .filter((p) => p.kmGps > 0 || p.viagens > 0)
              .map((p) => (
                <tr key={p.dia} className="border-b border-border/50">
                  <td className="py-1.5">{diaCurto(p.dia)}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.kmGps.toLocaleString("pt-BR")}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.viagens}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
