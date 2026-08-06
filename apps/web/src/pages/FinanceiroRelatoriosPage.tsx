import { useCallback, useEffect, useState } from "react";
import {
  FAIXAS_ATRASO,
  REGIMES,
  formatarMoeda,
  mesAtual,
  paraCentavos,
  somarMeses,
  type CategoriaFinanceiraPublic,
  type ComposicaoCategoria,
  type DreResultado,
  type InadimplenciaResultado,
  type Regime,
  type SerieMensalResultado,
} from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BarrasValor } from "@/components/financeiro/BarrasValor";
import { SerieMensalChart } from "@/components/financeiro/SerieMensalChart";
import { FinanceiroTabs } from "@/components/financeiro/FinanceiroTabs";
import { CategoriasCard } from "@/components/financeiro/CategoriasCard";
import { financeiroApi } from "@/lib/financeiroApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { AlertTriangle, Printer } from "lucide-react";

/**
 * RELATORIOS DO FINANCEIRO DA HUBISP — DRE, inadimplencia e evolucao mensal.
 *
 * Nada e somado aqui. Todo numero desta tela ja chega calculado do servidor,
 * agregado no Postgres; a pagina formata e desenha. Somar no navegador daria o
 * total do que coube na resposta, e passaria por aritmetica de float pra fazer
 * isso — as duas coisas que o modulo inteiro evita.
 */

const REGIME_ROTULO: Record<Regime, string> = {
  competencia: "Competência",
  caixa: "Caixa",
};

const REGIME_EXPLICACAO: Record<Regime, string> = {
  competencia: "O mês a que o lançamento pertence, pago ou não — quanto a hub faturou e gastou.",
  caixa: "O mês em que o dinheiro se moveu (só o que foi baixado) — quanto entrou e saiu.",
};

export function FinanceiroRelatoriosPage() {
  const { toast } = useToast();

  const [regime, setRegime] = useState<Regime>("competencia");
  const [de, setDe] = useState(() => somarMeses(mesAtual(), -11));
  const [ate, setAte] = useState(() => mesAtual());

  const [dre, setDre] = useState<DreResultado | null>(null);
  const [serie, setSerie] = useState<SerieMensalResultado | null>(null);
  const [composicao, setComposicao] = useState<ComposicaoCategoria[]>([]);
  const [inadimplencia, setInadimplencia] = useState<InadimplenciaResultado | null>(null);
  const [categorias, setCategorias] = useState<CategoriaFinanceiraPublic[]>([]);
  const [carregando, setCarregando] = useState(true);

  const periodoInvalido = de > ate;

  const carregar = useCallback(async () => {
    if (periodoInvalido) return;
    setCarregando(true);
    try {
      const p = { de, ate, regime };
      const [d, s, c, i] = await Promise.all([
        financeiroApi.dre(p),
        financeiroApi.serieMensal(p),
        financeiroApi.composicaoDespesa(p),
        // Inadimplencia NAO depende do periodo nem do regime: ela e uma foto de
        // HOJE — o que esta vencido agora, independente de quando venceu.
        financeiroApi.inadimplencia(),
      ]);
      setDre(d);
      setSerie(s);
      setComposicao(c);
      setInadimplencia(i);
    } catch (err) {
      toast({
        titulo: "Não deu para carregar os relatórios",
        descricao: err instanceof ApiError ? err.message : "Tente de novo em instantes.",
        variante: "erro",
      });
    } finally {
      setCarregando(false);
    }
  }, [de, ate, regime, periodoInvalido, toast]);

  const carregarCategorias = useCallback(() => {
    void financeiroApi.categorias().then(setCategorias).catch(() => setCategorias([]));
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(carregarCategorias, [carregarCategorias]);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Resultado, inadimplência e evolução — números da HubISP.
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11 print:hidden"
            >
              <Printer className="size-4" aria-hidden />
              Imprimir
            </button>
          </div>

          <FinanceiroTabs atual="relatorios" />
        </header>

        {/* Recorte. `print:hidden` — o papel guarda o resultado, não os controles. */}
        <Card className="print:hidden">
          <CardContent className="flex flex-wrap items-end gap-4 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="rel-regime">Regime</Label>
              <Select
                id="rel-regime"
                value={regime}
                onChange={(e) => setRegime(e.target.value as Regime)}
              >
                {REGIMES.map((r) => (
                  <option key={r} value={r}>
                    {REGIME_ROTULO[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rel-de">De</Label>
              <Input id="rel-de" type="month" value={de} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rel-ate">Até</Label>
              <Input id="rel-ate" type="month" value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
            <p className="max-w-sm flex-1 text-xs text-muted-foreground">
              {REGIME_EXPLICACAO[regime]}
            </p>
          </CardContent>
        </Card>

        {periodoInvalido && (
          <p role="alert" className="text-sm text-destructive">
            O mês inicial não pode ser depois do final.
          </p>
        )}

        <BlocoDre dre={dre} carregando={carregando} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Evolução mensal</CardTitle>
              <CardDescription>Receita e despesa, mês a mês.</CardDescription>
            </CardHeader>
            <CardContent>
              {carregando || !serie ? <Skeleton className="h-48" /> : <SerieMensalChart pontos={serie.pontos} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Despesa por categoria</CardTitle>
              <CardDescription>Onde o dinheiro da hub está indo.</CardDescription>
            </CardHeader>
            <CardContent>
              {carregando ? (
                <Skeleton className="h-48" />
              ) : (
                <BarrasValor
                  vazio="Nenhuma despesa no período."
                  itens={composicao.map((c) => ({
                    id: c.categoriaId ?? "sem-categoria",
                    rotulo: c.nome,
                    cor: c.cor,
                    valor: c.valor,
                    detalhe: c.classificacao ? undefined : "sem classificação no DRE",
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <BlocoInadimplencia dados={inadimplencia} carregando={carregando} />

        {/*
          Fica DEPOIS do DRE de propósito: quem chega aqui já viu o aviso de
          "sem classificação" e sabe por que a lista importa.
        */}
        <CategoriasCard
          categorias={categorias}
          onMudou={() => {
            carregarCategorias();
            // O DRE muda quando uma categoria e reclassificada — recarregar
            // so a lista deixaria o demonstrativo mostrando a conta antiga.
            void carregar();
          }}
        />
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// DRE
// ---------------------------------------------------------------------------

function BlocoDre({ dre, carregando }: { dre: DreResultado | null; carregando: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Demonstrativo de resultado</CardTitle>
        <CardDescription>
          {dre ? `Regime de ${REGIME_ROTULO[dre.regime].toLowerCase()} · ${dre.de} a ${dre.ate}` : "—"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {carregando || !dre ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            {/*
              O aviso vem ANTES da tabela, de propósito. Um DRE com despesa não
              classificada continua somando certo, mas não diz de onde vem o
              gasto — e quem lê a tabela primeiro já formou uma opinião.
            */}
            {dre.quantidadeSemClassificacao > 0 && (
              <div
                role="status"
                className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <p>
                  <strong>{formatarMoeda(dre.semClassificacao)}</strong> em despesas sem classificação
                  ({dre.quantidadeSemClassificacao} lançamento
                  {dre.quantidadeSemClassificacao > 1 ? "s" : ""}). O valor está descontado do
                  resultado, mas não aparece em nenhuma linha de custo — classifique as categorias
                  para que o demonstrativo diga de onde vem o gasto.
                </p>
              </div>
            )}

            <table className="w-full text-sm">
              <caption className="sr-only">Demonstrativo de resultado do exercício</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">Linha</th>
                  <th className="py-2 text-right font-medium">Valor</th>
                  <th className="py-2 text-right font-medium">% da receita</th>
                </tr>
              </thead>
              <tbody>
                {dre.linhas.map((l) => {
                  const negativo = paraCentavos(l.valor) < 0;
                  return (
                    <tr
                      key={l.chave}
                      className={cn(
                        "border-b border-border/50",
                        l.operacao === "total" && "font-semibold",
                        l.chave === "resultado" && "border-t-2 border-t-border text-base",
                        l.alerta && "text-destructive",
                      )}
                    >
                      <td className="py-2">{l.rotulo}</td>
                      <td
                        className={cn(
                          "py-2 text-right font-mono tabular-nums",
                          negativo && "text-destructive",
                        )}
                      >
                        {formatarMoeda(l.valor)}
                      </td>
                      <td className="py-2 text-right font-mono text-muted-foreground tabular-nums">
                        {l.percentualDaReceita === null ? "—" : `${l.percentualDaReceita}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/*
              Honestidade sobre o que o número NÃO cobre. O ERP de origem chama a
              última linha de EBITDA sem rastrear depreciação nem IR — o rótulo
              promete mais do que o dado entrega.
            */}
            <p className="mt-3 text-xs text-muted-foreground">
              O resultado operacional não considera depreciação, resultado financeiro nem imposto
              sobre o lucro — nada disso é registrado no sistema.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Inadimplencia
// ---------------------------------------------------------------------------

function BlocoInadimplencia({
  dados,
  carregando,
}: {
  dados: InadimplenciaResultado | null;
  carregando: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inadimplência</CardTitle>
        <CardDescription>
          O que os provedores devem à hub e já venceu — foto de hoje, independente do período acima.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {carregando || !dados ? (
          <Skeleton className="h-48" />
        ) : paraCentavos(dados.total) === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nada vencido. Todos os provedores em dia.
          </p>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total vencido
              </p>
              <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-destructive">
                {formatarMoeda(dados.total)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {dados.quantidade} lançamento{dados.quantidade > 1 ? "s" : ""} em atraso
              </p>
            </div>

            {/* Faixas de atraso: mais velho = mais difícil de receber. */}
            <div className="grid gap-3 sm:grid-cols-4">
              {FAIXAS_ATRASO.map((faixa) => (
                <div key={faixa.chave} className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">{faixa.rotulo}</p>
                  <p
                    className={cn(
                      "mt-0.5 font-mono font-semibold tabular-nums",
                      // Só a faixa mais grave colore — se tudo fosse vermelho,
                      // nada seria.
                      faixa.chave === "mais90" &&
                        paraCentavos(dados.porFaixa[faixa.chave]) > 0 &&
                        "text-destructive",
                    )}
                  >
                    {formatarMoeda(dados.porFaixa[faixa.chave])}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <h3 className="mb-3 text-sm font-medium">Por provedor</h3>
              <BarrasValor
                vazio="Nenhum provedor em atraso."
                itens={dados.porProvedor.map((p) => ({
                  id: p.provedorId ?? "sem-provedor",
                  rotulo: p.provedorNome,
                  cor: p.provedorCor,
                  valor: p.total,
                  detalhe: `${p.quantidade} lançamento${p.quantidade > 1 ? "s" : ""} · mais antigo há ${p.diasAtrasoMaximo} dia${p.diasAtrasoMaximo > 1 ? "s" : ""}`,
                }))}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
