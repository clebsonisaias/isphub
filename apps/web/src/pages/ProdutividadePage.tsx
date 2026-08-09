import { useCallback, useEffect, useState } from "react";
import {
  MINIMO_AMOSTRAS_PESO,
  type BiProdutividade,
  type LinhaTecnico,
} from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SerieDiariaOs } from "@/components/produtividade/SerieDiariaOs";
import { produtividadeApi } from "@/lib/produtividadeApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { Info, Printer, Trophy, Users } from "lucide-react";

/**
 * PRODUTIVIDADE DA EQUIPE.
 *
 * Esta tela e diferente das outras do projeto, e a diferenca nao e visual: cada
 * linha tem o NOME de uma pessoa, e o numero ao lado vai virar conversa. Tres
 * decisoes de layout saem inteiramente disso:
 *
 * 1. **A pontuacao nunca aparece sozinha.** Ao lado dela ficam sempre as OS
 *    cruas e o quanto entrou sem peso medido. Um numero indiscutivel e um
 *    numero que ninguem consegue contestar quando ele esta errado.
 *
 * 2. **A tabela de pesos fica na tela, aberta, e nao escondida num "sobre".**
 *    Quem e comparado tem direito de ver a regra da comparacao. E se um peso
 *    estiver errado, e assim que alguem descobre.
 *
 * 3. **"Nao sabemos" tem cor propria, e nunca a cor de "errado".** Quem nao
 *    registrou jornada nao esta em falta com nada — o app dele pode nem ter
 *    pedido. Pintar isso de vermelho seria acusar por lacuna de dado.
 */

function isoLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function diasAtras(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoLocal(d);
}

/** "95" -> "1h 35min". Duracao medida, nunca estimada. */
function duracao(min: number | null): string {
  if (min === null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function um(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function ProdutividadePage() {
  const { toast } = useToast();

  const [de, setDe] = useState(() => diasAtras(29));
  const [ate, setAte] = useState(() => isoLocal(new Date()));
  const [dados, setDados] = useState<BiProdutividade | null>(null);
  const [carregando, setCarregando] = useState(true);

  const periodoInvalido = de > ate;

  const carregar = useCallback(async () => {
    if (periodoInvalido) return;
    setCarregando(true);
    try {
      setDados(await produtividadeApi.bi(de, ate));
    } catch (err) {
      toast({
        titulo: "Não deu para carregar a produtividade",
        descricao: err instanceof ApiError ? err.message : "Tente de novo em instantes.",
        variante: "erro",
      });
    } finally {
      setCarregando(false);
    }
  }, [de, ate, periodoInvalido, toast]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const lider = dados?.tecnicos.find((t) => t.usuarioId !== null) ?? null;

  return (
    <AppShell>
      <AnimatedPage>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 lg:p-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold">
                <Trophy className="size-5 text-primary" aria-hidden />
                Produtividade
              </h1>
              <p className="text-sm text-muted-foreground">
                Quem fechou o quê — e quanto cada serviço realmente pesa.
              </p>
            </div>
            <Button variant="ghost" className="print:hidden" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              Imprimir
            </Button>
          </header>

          <Card className="print:hidden">
            <CardContent className="flex flex-wrap items-end gap-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="pr-de">De</Label>
                <Input id="pr-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-ate">Até</Label>
                <Input id="pr-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
              </div>
              <p className="max-w-md flex-1 text-xs text-muted-foreground">
                O crédito é do técnico atribuído à OS, e não de quem apertou o botão — quando o
                gestor fecha pelo painel, quem fez o serviço continua sendo quem fez.
              </p>
            </CardContent>
          </Card>

          {periodoInvalido && (
            <p role="alert" className="text-sm text-destructive">
              A data inicial não pode ser depois da final.
            </p>
          )}

          {carregando || !dados ? (
            <Skeleton className="h-28" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi rotulo="OS concluídas" valor={dados.resumo.concluidas.toLocaleString("pt-BR")} />
              <Kpi
                rotulo="Pontos no período"
                valor={um(dados.resumo.pontos)}
                nota={dados.resumo.calibrado ? "todos os tipos calibrados" : "há tipo sem peso medido"}
              />
              <Kpi
                rotulo="Tempo típico de uma OS"
                valor={duracao(dados.resumo.medianaGeralMin)}
                nota="mediana — a referência de todos os pesos"
              />
              <Kpi
                rotulo="Quem trabalhou"
                valor={`${dados.resumo.tecnicosAtivos}`}
                nota={dados.resumo.tecnicosAtivos === 1 ? "técnico com OS fechada" : "técnicos com OS fechada"}
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>OS concluídas por dia</CardTitle>
              <CardDescription>
                Barras em OS; a linha de pontos mostra quando um dia curto valeu mais que um dia
                cheio.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {carregando || !dados ? <Skeleton className="h-40" /> : <SerieDiariaOs pontos={dados.serie} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" aria-hidden />
                Ranking da equipe
              </CardTitle>
              <CardDescription>
                Ordenado por pontos, não por quantidade — quem faz o serviço demorado não fica
                atrás de quem faz o rápido.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {carregando || !dados ? (
                <Skeleton className="mx-4 h-56" />
              ) : (
                <Ranking tecnicos={dados.tecnicos} maximo={lider?.pontuacao.pontos ?? 0} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quanto pesa cada serviço</CardTitle>
              <CardDescription>
                O peso é a mediana de duração do tipo dividida pela mediana geral — medido nesta
                operação, não escolhido por ninguém.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {carregando || !dados ? <Skeleton className="mx-4 h-40" /> : <TabelaPesos dados={dados} />}
            </CardContent>
          </Card>
        </div>
      </AnimatedPage>
    </AppShell>
  );
}

function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{valor}</p>
        {nota && <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>}
      </CardContent>
    </Card>
  );
}

function Ranking({ tecnicos, maximo }: { tecnicos: LinhaTecnico[]; maximo: number }) {
  if (tecnicos.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma OS concluída no período.</p>;
  }

  return (
    <ul className="flex flex-col">
      {tecnicos.map((t, i) => {
        const p = t.pontuacao;
        // Piso de 2%: barra de largura zero le como "nao fez nada", e a pessoa
        // esta na lista justamente porque fez.
        const largura = maximo > 0 ? Math.max(2, Math.round((p.pontos / maximo) * 100)) : 0;
        return (
          <li key={t.usuarioId ?? "sem-tecnico"} className="border-b border-border/50 px-4 py-3 last:border-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="w-5 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {t.usuarioId ? i + 1 : "—"}
                </span>
                <span className={`truncate font-medium ${t.usuarioId ? "" : "text-muted-foreground"}`}>
                  {t.nome}
                </span>
              </span>
              <span className="shrink-0 text-sm">
                <strong className="tabular-nums">{um(p.pontos)}</strong>{" "}
                <span className="text-muted-foreground">pts</span>
                {/*
                  As OS cruas ficam SEMPRE ao lado dos pontos. A pontuacao e uma
                  interpretacao do trabalho; a contagem e o fato. Esconder o fato
                  transformaria um numero discutivel num numero indiscutivel.
                */}
                <span className="ml-2 tabular-nums text-muted-foreground">· {p.concluidas} OS</span>
              </span>
            </div>

            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/80" style={{ width: `${largura}%` }} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>tempo típico {duracao(t.duracaoMedianaMin)}</span>

              {/* Como fechou — o autor, que NAO e quem leva o credito. */}
              {/*
                "pelo próprio", e nao "por ele mesmo": o rotulo aparece ao lado
                do nome de qualquer pessoa da equipe, e uma delas nao e "ele".
              */}
              {t.comoFechou.eleMesmo > 0 && <span>{t.comoFechou.eleMesmo} fechadas pelo próprio</span>}
              {t.comoFechou.outroUsuario > 0 && (
                <span>{t.comoFechou.outroUsuario} fechadas por outra pessoa</span>
              )}
              {t.comoFechou.peloSgp > 0 && <span>{t.comoFechou.peloSgp} apareceram fechadas do SGP</span>}

              {/* Acompanhamento. `sem_declaracao` NAO vira "sozinho". */}
              {t.acompanhamento.sozinho > 0 && <Chip>{t.acompanhamento.sozinho} sozinho</Chip>}
              {t.acompanhamento.acompanhado > 0 && <Chip>{t.acompanhamento.acompanhado} com colega</Chip>}
              {t.acompanhamento.sem_declaracao > 0 && (
                <Chip neutro>{t.acompanhamento.sem_declaracao} sem viatura declarada</Chip>
              )}

              {/* Jornada. "nao registrou" e cinza, nunca vermelho. */}
              {t.expediente.fora > 0 && <Chip>{t.expediente.fora} fora da jornada</Chip>}
              {t.expediente.nao_registrou > 0 && (
                <Chip neutro>{t.expediente.nao_registrou} sem jornada registrada</Chip>
              )}

              {p.semPeso > 0 && (
                <Chip neutro>
                  {p.semPeso} {p.semPeso === 1 ? "valeu" : "valeram"} 1,0 por falta de amostra
                </Chip>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * `neutro` e o que separa "nao sabemos" de "olhe isto".
 *
 * Quem nao registrou jornada nao esta em falta com nada — o app dele pode nem
 * ter pedido. Pintar de vermelho seria acusar alguem por uma lacuna de dado.
 */
function Chip({ children, neutro }: { children: React.ReactNode; neutro?: boolean }) {
  return (
    <span
      className={
        neutro
          ? "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
          : "rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
      }
    >
      {children}
    </span>
  );
}

function TabelaPesos({ dados }: { dados: BiProdutividade }) {
  if (dados.pesos.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum serviço medido no período.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Serviço</th>
            <th className="px-4 py-2 text-right font-medium">Tempo típico</th>
            <th className="px-4 py-2 text-right font-medium">Amostras</th>
            <th className="px-4 py-2 text-right font-medium">Peso</th>
          </tr>
        </thead>
        <tbody>
          {dados.pesos.map((p) => (
            <tr key={p.tipoOsId ?? "sem-tipo"} className="border-b border-border/50">
              <td className="px-4 py-2">{p.nome}</td>
              <td className="px-4 py-2 text-right tabular-nums">{duracao(p.medianaMin)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{p.amostras}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {p.peso !== null ? (
                  <strong>{p.peso.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×</strong>
                ) : (
                  /*
                    O caso que a tela existe pra nao esconder: sem amostra nao ha
                    peso, e as OS deste tipo entraram valendo 1,0. Mostrar "1,00×"
                    aqui daria a um palpite a mesma aparencia de uma medicao.
                  */
                  <span className="text-xs text-muted-foreground">
                    sem peso — precisa de {MINIMO_AMOSTRAS_PESO}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flex items-start gap-1.5 px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          O tempo conta do momento em que o técnico marcou &quot;a caminho&quot; até fechar — não da
          abertura da OS, porque fila não é trabalho de técnico. OS acima de 12 horas ficam fora da
          mediana: quase sempre é alguém que esqueceu de fechar.
        </span>
      </p>
    </div>
  );
}
