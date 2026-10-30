import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  rotuloDataHora,
  formatarCustoPorKm,
  formatarMoeda,
  litrosOciosos,
  paraCentavos,
  SEM_BASE_MOTIVO_ROTULO,
  type BiAuditoria,
  type BiCusto,
  type BiUso,
  type LinhaVeiculo,
  type Rastreamento,
} from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { BarrasValor } from "@/components/financeiro/BarrasValor";
import { SerieDiariaKm } from "@/components/frota/SerieDiariaKm";
import { biFrotaApi } from "@/lib/biFrotaApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { AlertTriangle, BarChart3, Gauge, Printer, Timer, Truck } from "lucide-react";

/**
 * BI DA FROTA — quanto custa e como esta sendo usada.
 *
 * A tela existe porque o ISPhub passou a ter DUAS medidas independentes da
 * mesma distancia: o odometro, que o tecnico digita, e o GPS, que o rastreador
 * mede. Um relatorio mostraria as duas; este painel foi desenhado em torno do
 * que elas nao contam sozinhas.
 *
 * Duas regras mandam no layout:
 *
 * 1. **Metade da frota nao tem rastreador, e a tela precisa DIZER isso.** Onde
 *    falta rastreador nao aparece "0 km" — aparece "sem rastreador". O tipo
 *    `Rastreamento` e uma uniao justamente para tornar o "0 km" impossivel de
 *    escrever aqui: o campo `kmGps` nao existe naquele ramo.
 *
 * 2. **Nada e somado no navegador.** Todo total ja chega agregado do Postgres.
 *    Somar aqui daria o total do que coube na resposta — e passaria dinheiro
 *    por float pra fazer isso.
 */

/** "2.02" em pt-BR e "2,02" — `toFixed` devolve ponto e nao serve pra tela. */
function razao(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * "YYYY-MM-DD" no relogio de quem esta lendo, e nao em UTC.
 *
 * `toISOString()` seria uma linha, e erraria: as 22h em Natal ele devolve o dia
 * SEGUINTE, e o filtro abriria com uma data que ainda nao chegou.
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

function hoje(): string {
  return isoLocal(new Date());
}

export function FrotaBiPage() {
  const { toast } = useToast();

  const [de, setDe] = useState(() => diasAtras(89));
  const [ate, setAte] = useState(hoje);

  const [custo, setCusto] = useState<BiCusto | null>(null);
  const [uso, setUso] = useState<BiUso | null>(null);
  const [auditoria, setAuditoria] = useState<BiAuditoria | null>(null);
  const [carregando, setCarregando] = useState(true);

  const periodoInvalido = de > ate;

  const carregar = useCallback(async () => {
    if (periodoInvalido) return;
    setCarregando(true);
    /*
     * `allSettled` e nao `all`: os blocos sao independentes, e a auditoria (a
     * consulta mais cara) nao pode derrubar o custo, que e o que o gestor abriu
     * a tela pra ver. Mesmo padrao do Dashboard.
     */
    const [c, u, a] = await Promise.allSettled([
      biFrotaApi.custo(de, ate),
      biFrotaApi.uso(de, ate),
      biFrotaApi.auditoria(de, ate),
    ]);
    if (c.status === "fulfilled") setCusto(c.value);
    if (u.status === "fulfilled") setUso(u.value);
    if (a.status === "fulfilled") setAuditoria(a.value);
    const falhou = [c, u, a].find((r) => r.status === "rejected");
    if (falhou?.status === "rejected") {
      toast({
        titulo: "Parte do painel não carregou",
        descricao: falhou.reason instanceof ApiError ? falhou.reason.message : "Tente de novo em instantes.",
        variante: "erro",
      });
    }
    setCarregando(false);
  }, [de, ate, periodoInvalido, toast]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <AppShell>
      <AnimatedPage>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 lg:p-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold">
                <BarChart3 className="size-5 text-primary" aria-hidden />
                Frota em números
              </h1>
              <p className="text-sm text-muted-foreground">
                Quanto cada quilômetro custa e como a frota está sendo usada.
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="ghost" asChild>
                <Link to="/frota">
                  <Truck className="size-4" aria-hidden />
                  Veículos
                </Link>
              </Button>
              <Button variant="ghost" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden />
                Imprimir
              </Button>
            </div>
          </header>

          {/* O papel guarda os números, não os controles. */}
          <Card className="print:hidden">
            <CardContent className="flex flex-wrap items-end gap-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="bi-de">De</Label>
                <Input id="bi-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bi-ate">Até</Label>
                <Input id="bi-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
              </div>
              <p className="max-w-md flex-1 text-xs text-muted-foreground">
                Custo e odômetro valem para a frota inteira. Quilometragem por GPS só existe onde há
                rastreador instalado — e a tela diz quando não há.
              </p>
            </CardContent>
          </Card>

          {periodoInvalido && (
            <p role="alert" className="text-sm text-destructive">
              A data inicial não pode ser depois da final.
            </p>
          )}

          <BlocoResumo custo={custo} uso={uso} carregando={carregando} />

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Quilometragem por dia</CardTitle>
                <CardDescription>
                  Somente veículos com rastreador. Os dias sem viagem aparecem como coluna vazia.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {carregando || !uso ? <Skeleton className="h-40" /> : <SerieDiariaKm pontos={uso.serie} totalKm={uso.resumo.kmGps} />}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Gasto por veículo</CardTitle>
                <CardDescription>Combustível e qualquer despesa lançada com veículo.</CardDescription>
              </CardHeader>
              <CardContent>
                {carregando || !custo ? <Skeleton className="h-40" /> : <RankingGasto custo={custo} />}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Custo por quilômetro</CardTitle>
              <CardDescription>
                O R$/km sai do ODÔMETRO, não do GPS — por isso vale também para quem não tem rastreador.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {carregando || !custo ? (
                <Skeleton className="mx-4 h-40" />
              ) : (
                <TabelaCusto veiculos={custo.veiculos} uso={uso} />
              )}
            </CardContent>
          </Card>

          <BlocoComportamento uso={uso} carregando={carregando} />

          <BlocoAuditoria auditoria={auditoria} carregando={carregando} />

          <Card>
            <CardHeader>
              <CardTitle>Preço do litro por posto</CardTitle>
              <CardDescription>
                Valor total dividido pelos litros — não é a média dos preços de bomba.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {carregando || !custo ? (
                <Skeleton className="h-32" />
              ) : (
                <BarrasValor
                  vazio="Nenhum abastecimento registrado no período."
                  itens={custo.porPosto.map((p) => ({
                    id: p.posto,
                    rotulo: p.posto,
                    valor: p.gasto,
                    detalhe: `${Number(p.litros).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} L${
                      p.precoMedio ? ` · ${formatarMoeda(p.precoMedio)}/L` : ""
                    }`,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </AnimatedPage>
    </AppShell>
  );
}

/** "12345" segundos -> "3h 25min". Duração medida, não estimada. */
function duracao(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.round((segundos % 3600) / 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

/**
 * COMO ESTÃO DIRIGINDO — excesso de velocidade e motor ligado parado.
 *
 * O `excesso_velocidade` é gerado desde a Fase 2 e nunca foi lido em lugar
 * nenhum. Este bloco é o primeiro consumidor dele.
 */
function BlocoComportamento({ uso, carregando }: { uso: BiUso | null; carregando: boolean }) {
  if (carregando || !uso) return <Skeleton className="h-40" />;

  const litros = litrosOciosos(uso.resumo.ociosoSeg);
  const semExcesso = uso.excessos.length === 0;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="size-4 text-muted-foreground" aria-hidden />
            Motor ligado, carro parado
          </CardTitle>
          <CardDescription>
            Tempo somado das viagens, com ignição ligada e velocidade zerada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tabular-nums">{duracao(uso.resumo.ociosoSeg)}</p>
          {litros !== null && (
            /*
              O tempo e MEDIDO; os litros sao INFERIDOS de uma taxa de
              referencia de marcha lenta. Sao dois graus de confianca
              diferentes, e por isso o segundo vem menor, cinza e com a palavra
              "estimativa" escrita — nao ao lado do primeiro, com o mesmo peso.
            */
            <p className="mt-1 text-sm text-muted-foreground">
              ≈ {litros.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} litros queimados à toa{" "}
              <span className="text-xs">(estimativa por marcha lenta, não medição)</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Excesso de velocidade</CardTitle>
          <CardDescription>Ocorrências registradas pelo rastreador no período.</CardDescription>
        </CardHeader>
        <CardContent>
          {semExcesso ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma ocorrência — ou nenhum veículo com rastreador no período.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {uso.excessos.slice(0, 8).map((e, i) => (
                <li key={e.veiculoId ?? `sem-${i}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {e.placa ? (
                      e.placa
                    ) : (
                      /* Rastreador sem vinculo vigente: a ocorrencia existe e o
                         carro nao — some-la seria perder o sinal. */
                      <span className="text-muted-foreground">rastreador sem veículo vinculado</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums font-medium">{e.ocorrencias}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * O QUE NÃO BATE — o bloco central da tela.
 *
 * Quatro sinais, e o primeiro é o único que depende de GPS. A ordem importa: a
 * divergência odômetro×GPS vem primeiro porque é a que exige leitura, e os
 * outros três funcionam mesmo sem rastreador nenhum.
 *
 * **Nada aqui acusa.** "Revisar" e não "irregular": o que o painel sabe é que o
 * carro mudou em relação a ele mesmo. Pode ser furto, pode ser odômetro digitado
 * errado, pode ser um aparelho começando a falhar — e os dois números crus vêm
 * junto, para o leitor poder discordar.
 */
function BlocoAuditoria({ auditoria, carregando }: { auditoria: BiAuditoria | null; carregando: boolean }) {
  if (carregando || !auditoria) return <Skeleton className="h-56" />;

  const revisar = auditoria.divergencias.filter((d) => d.veredito.tipo === "revisar");
  const semBase = auditoria.divergencias.filter((d) => d.veredito.tipo === "sem_base");

  const nadaAApontar =
    revisar.length === 0 &&
    auditoria.abastecimentoSemRodagem.length === 0 &&
    auditoria.viagensSemOcupacao.length === 0 &&
    auditoria.rastreadoresMudos.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" aria-hidden />O que não bate
        </CardTitle>
        <CardDescription>
          Sinais para conferir — não conclusões. Cada linha traz os números crus que a geraram.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {nadaAApontar && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nada a apontar no período. {semBase.length > 0 && `${semBase.length} veículo(s) sem base para comparar.`}
          </p>
        )}

        {revisar.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Odômetro e GPS discordam</h3>
            <ul className="flex flex-col gap-2">
              {revisar.map((d) => {
                const v = d.veredito;
                if (v.tipo !== "revisar") return null;
                return (
                  <li key={d.veiculoId} className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link to={`/frota/veiculos/${d.veiculoId}`} className="font-medium hover:underline">
                        {d.placa}
                      </Link>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        cobertura do rastreador {d.coberturaPct ?? "—"}%
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      O odômetro andou <strong className="text-foreground tabular-nums">{razao(v.razao)}×</strong> o
                      que o GPS viu; este carro costuma fazer{" "}
                      <strong className="text-foreground tabular-nums">{razao(v.base)}×</strong>.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {d.kmOdometro?.toLocaleString("pt-BR") ?? "—"} km no odômetro ·{" "}
                      {d.kmGps?.toLocaleString("pt-BR") ?? "—"} km por GPS
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {auditoria.abastecimentoSemRodagem.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Abasteceu num dia sem viagem registrada</h3>
            <ListaSimples
              itens={auditoria.abastecimentoSemRodagem.slice(0, 10).map((a) => ({
                id: `${a.veiculoId}-${a.data}`,
                veiculoId: a.veiculoId,
                placa: a.placa,
                direita: `${a.data.split("-").reverse().join("/")} · ${Number(a.litros).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} L`,
              }))}
              total={auditoria.abastecimentoSemRodagem.length}
            />
          </section>
        )}

        {auditoria.viagensSemOcupacao.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Rodou sem ninguém ter assumido o carro</h3>
            <ListaSimples
              itens={auditoria.viagensSemOcupacao.slice(0, 10).map((v) => ({
                id: v.veiculoId,
                veiculoId: v.veiculoId,
                placa: v.placa,
                direita: `${v.viagens} ${v.viagens === 1 ? "viagem" : "viagens"}`,
              }))}
              total={auditoria.viagensSemOcupacao.length}
            />
          </section>
        )}

        {auditoria.rastreadoresMudos.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Rastreador sem posição nova</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Enquanto estiver assim, o número de GPS deste carro está incompleto — e é isso, e não o
              motorista, que explica qualquer divergência dele.
            </p>
            <ListaSimples
              itens={auditoria.rastreadoresMudos.slice(0, 10).map((r, i) => ({
                id: r.veiculoId ?? `mudo-${i}`,
                veiculoId: r.veiculoId,
                placa: r.placa ?? "sem veículo vinculado",
                direita: `${MOTIVO_MUDO[r.motivo]}${
                  r.desde ? ` · desde ${rotuloDataHora(r.desde)}` : ""
                }`,
              }))}
              total={auditoria.rastreadoresMudos.length}
            />
          </section>
        )}

        {semBase.length > 0 && (
          /*
            Os "sem base" ficam VISIVEIS, num recolhivel. Some-los faria a tela
            parecer ter auditado a frota inteira quando auditou uma parte — e a
            razao de cada omissao (aparelho cego, historico curto) e acionavel:
            conserta-la e o que faz o painel enxergar mais no mes que vem.
          */
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              {semBase.length} veículo(s) sem base para comparar
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {semBase.map((d) => (
                <li key={d.veiculoId} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>{d.placa}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.veredito.tipo === "sem_base" && SEM_BASE_MOTIVO_ROTULO[d.veredito.motivo]}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function ListaSimples({
  itens,
  total,
}: {
  itens: { id: string; veiculoId: string | null; placa: string; direita: string }[];
  total: number;
}) {
  return (
    <>
      <ul className="flex flex-col gap-1.5 text-sm">
        {itens.map((i) => (
          <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2">
            {i.veiculoId ? (
              <Link to={`/frota/veiculos/${i.veiculoId}`} className="hover:underline">
                {i.placa}
              </Link>
            ) : (
              <span className="text-muted-foreground">{i.placa}</span>
            )}
            <span className="text-xs tabular-nums text-muted-foreground">{i.direita}</span>
          </li>
        ))}
      </ul>
      {total > itens.length && (
        <p className="mt-1.5 text-xs text-muted-foreground">e mais {total - itens.length} — recorte de 10.</p>
      )}
    </>
  );
}

/**
 * Cada motivo pede uma ACAO diferente, e por isso vira texto e nao icone.
 *
 * "Falando, mas sem GPS" e o unico dos tres que descreve um carro possivelmente
 * EM MOVIMENTO — o aparelho comunica, nenhum alerta de offline dispara, e o
 * mapa mostra o veiculo parado na ultima coordenada. Quem le precisa saber que
 * este e diferente de "sem energia".
 */
const MOTIVO_MUDO: Record<BiAuditoria["rastreadoresMudos"][number]["motivo"], string> = {
  cego: "falando, mas sem sinal de GPS",
  calado: "sem comunicação nenhuma",
  dormindo: "em modo de economia (silêncio esperado)",
  nunca_reportou: "nunca reportou posição",
  indeterminado: "sem leitura do rádio ainda",
};

/** Quantas barras cabem antes de o ranking virar lista. */
const TETO_RANKING = 12;

/**
 * Os veiculos que mais gastaram — com teto, e DIZENDO qual e o teto.
 *
 * Uma frota de sessenta placas renderiza sessenta barras, e um ranking de
 * sessenta itens nao e um ranking: e uma tabela ruim. O corte e em doze; a linha
 * de baixo existe porque um corte silencioso le como "e isso que existe", e o
 * leitor precisaria descobrir sozinho que ha mais frota fora da tela.
 */
function RankingGasto({ custo }: { custo: BiCusto }) {
  // Ordenar ANTES de cortar: `BarrasValor` ordena por conta propria, mas um
  // slice sobre a ordem crua traria os doze primeiros por placa, nao os doze
  // que mais gastaram — e o card se chama "gasto por veiculo".
  const comGasto = custo.veiculos
    .filter((v) => v.gastoTotal !== "0.00")
    .sort((a, b) => paraCentavos(b.gastoTotal) - paraCentavos(a.gastoTotal));
  const visiveis = comGasto.slice(0, TETO_RANKING);
  const ocultos = comGasto.length - visiveis.length;
  const corte = visiveis[visiveis.length - 1];

  return (
    <>
      <BarrasValor
        vazio="Nenhuma despesa lançada com veículo no período."
        itens={visiveis.map((v) => ({
          id: v.veiculoId,
          rotulo: v.placa,
          valor: v.gastoTotal,
          detalhe: detalheGasto(v),
        }))}
      />
      {ocultos > 0 && corte && (
        <p className="mt-3 text-xs text-muted-foreground">
          Mais {ocultos} {ocultos === 1 ? "veículo gastou" : "veículos gastaram"} até{" "}
          {formatarMoeda(corte.gastoTotal)} — fora deste recorte. A tabela abaixo tem todos.
        </p>
      )}
    </>
  );
}

/** A linha de baixo da barra: por que aquele gasto tem (ou não) um R$/km. */
function detalheGasto(v: LinhaVeiculo): string {
  const partes: string[] = [];
  if (v.abastecimentos > 0) partes.push(`${v.abastecimentos} abastecimento${v.abastecimentos > 1 ? "s" : ""}`);
  partes.push(v.kmOdometro !== null ? `${v.kmOdometro.toLocaleString("pt-BR")} km no odômetro` : "sem odômetro no período");
  if (v.custoPorKm) partes.push(formatarCustoPorKm(v.custoPorKm));
  return partes.join(" · ");
}

function BlocoResumo({
  custo,
  uso,
  carregando,
}: {
  custo: BiCusto | null;
  uso: BiUso | null;
  carregando: boolean;
}) {
  if (carregando || !custo) {
    return <Skeleton className="h-24" />;
  }

  const semRastreador = custo.resumo.veiculos - custo.resumo.comRastreador;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi rotulo="Gasto no período" valor={formatarMoeda(custo.resumo.gastoTotal)} mono />
      <Kpi
        rotulo="Combustível"
        valor={formatarMoeda(custo.resumo.gastoCombustivel)}
        mono
        nota={
          custo.resumo.precoMedioLitro ? `${formatarMoeda(custo.resumo.precoMedioLitro)} por litro` : undefined
        }
      />
      <Kpi
        rotulo="Rodado por GPS"
        valor={uso ? `${uso.resumo.kmGps.toLocaleString("pt-BR")} km` : "—"}
        nota={uso ? `${uso.resumo.viagens} viagens` : undefined}
      />
      {/*
        O quarto KPI e a HONESTIDADE do painel, e por isso ocupa o lugar de um
        numero: sem ele, um gestor le "12.000 km" como a frota inteira, quando e
        so a parte que tem aparelho.
      */}
      <Kpi
        rotulo="Cobertura do rastreador"
        valor={`${custo.resumo.comRastreador} de ${custo.resumo.veiculos}`}
        nota={
          semRastreador > 0
            ? `${semRastreador} sem rastreador — sem km por GPS`
            : "toda a frota é medida por GPS"
        }
      />
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  nota,
  mono,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  mono?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${mono ? "font-mono" : ""}`}>{valor}</p>
        {nota && <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>}
      </CardContent>
    </Card>
  );
}

/** O texto de UM ramo da união — a tela nunca inventa o outro. */
function textoRastreamento(r: Rastreamento | undefined): { texto: string; atenua: boolean } {
  if (!r) return { texto: "—", atenua: true };
  switch (r.tipo) {
    case "sem_rastreador":
      return { texto: "sem rastreador", atenua: true };
    case "sem_movimento":
      return { texto: "sem viagem no período", atenua: true };
    case "medido":
      return { texto: `${r.kmGps.toLocaleString("pt-BR")} km · ${r.viagens} viagens`, atenua: false };
  }
}

function TabelaCusto({ veiculos, uso }: { veiculos: LinhaVeiculo[]; uso: BiUso | null }) {
  if (veiculos.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum veículo no escopo.</p>;
  }

  const porVeiculo = new Map(uso?.veiculos.map((v) => [v.veiculoId, v.rastreamento]) ?? []);

  /*
   * So entra quem tem ALGUMA medida no periodo. Um veiculo sem gasto, sem
   * odometro e sem viagem renderiza uma linha de travessoes — e sessenta linhas
   * de travessao afogam as seis que tem numero. Mas some-los em silencio seria
   * o erro oposto, entao a contagem fica escrita embaixo: o leitor precisa
   * saber que a frota e maior do que a tabela.
   */
  const comDado = veiculos.filter(
    (v) => v.gastoTotal !== "0.00" || v.kmOdometro !== null || porVeiculo.get(v.veiculoId)?.tipo === "medido",
  );
  const semNada = veiculos.length - comDado.length;

  if (comDado.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhum dos {veiculos.length} veículos teve despesa, odômetro ou viagem no período.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Veículo</th>
            <th className="px-4 py-2 text-right font-medium">Gasto</th>
            <th className="px-4 py-2 text-right font-medium">km (odômetro)</th>
            <th className="px-4 py-2 text-right font-medium">R$/km</th>
            <th className="px-4 py-2 text-right font-medium">km/l</th>
            <th className="px-4 py-2 text-left font-medium">Pelo rastreador</th>
          </tr>
        </thead>
        <tbody>
          {comDado.map((v) => {
            const rastreio = textoRastreamento(porVeiculo.get(v.veiculoId));
            return (
              <tr key={v.veiculoId} className="border-b border-border/50">
                <td className="px-4 py-2">
                  <Link to={`/frota/veiculos/${v.veiculoId}`} className="font-medium hover:underline">
                    {v.placa}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{v.modelo}</span>
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">{formatarMoeda(v.gastoTotal)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {v.kmOdometro !== null ? (
                    v.kmOdometro.toLocaleString("pt-BR")
                  ) : (
                    <span className="text-xs text-muted-foreground">sem odômetro</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {formatarCustoPorKm(v.custoPorKm)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {v.kmPorLitro !== null ? (
                    v.kmPorLitro.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
                  ) : (
                    /*
                      `null` aqui e deliberado no servidor: km/l exige dois
                      tanques cheios. Mostrar um numero com um so seria inventar
                      consumo — e consumo inventado vira decisao sobre um carro.
                    */
                    <span className="text-xs text-muted-foreground" title="Precisa de dois abastecimentos completos">
                      —
                    </span>
                  )}
                </td>
                <td className={`px-4 py-2 ${rastreio.atenua ? "text-xs text-muted-foreground" : ""}`}>
                  <span className="inline-flex items-center gap-1.5">
                    {!rastreio.atenua && <Gauge className="size-3.5 text-primary" aria-hidden />}
                    {rastreio.texto}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {semNada > 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Mais {semNada} {semNada === 1 ? "veículo cadastrado não teve" : "veículos cadastrados não tiveram"} despesa,
          odômetro nem viagem no período — não aparecem acima.
        </p>
      )}
    </div>
  );
}
