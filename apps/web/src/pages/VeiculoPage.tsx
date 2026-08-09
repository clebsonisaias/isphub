import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  EMOJI_VEICULO,
  EVENTO_RASTREADOR_ROTULO,
  formatarDistancia,
  formatarPlaca,
  idadeDaPosicao,
  type EventoRastreadorTipo,
} from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { veiculosApi, frotaMapaApi, type VeiculoFrota } from "@/lib/veiculosApi";
import { ApiError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { ArrowLeft, Cpu, Route, Siren } from "lucide-react";

/**
 * A PAGINA DE UM VEICULO — o que o aparelho sabe, e o que o carro fez.
 *
 * O painel de sensores e renderizado A PARTIR DO DICIONARIO do fornecedor, e
 * nao de uma lista que eu escrevi. Isso nao e elegancia: e o que faz um
 * rastreador com sensor de temperatura, umidade ou porta aparecer aqui sem uma
 * linha de codigo nova. O fornecedor publica 14 hoje e pode publicar o 15o
 * amanha.
 *
 * Sem react-query, pela regra da casa (`lib/modulos.ts` documenta a queda de
 * producao causada por um `useQuery` sem QueryClient no provider da web).
 */

interface SensorNaTela {
  nome: string;
  rotulo: string;
  valor: string;
  resumo: string;
  severidade: "success" | "warning" | "danger" | null;
  icone: string | null;
}

interface ViagemNaTela {
  id: string;
  inicioEm: string;
  fimEm: string | null;
  distanciaMetros: number | null;
  velocidadeMaxKmh: number | null;
  paradoComMotorLigadoSeg: number | null;
  motorista: string | null;
}

interface EventoNaTela {
  id: string;
  tipo: EventoRastreadorTipo;
  em: string;
  detalhe: unknown;
}

interface DiaDoVeiculo {
  agoraServidor: string;
  rastreador: {
    identificadorExterno: string;
    apelido: string | null;
    modeloFornecedor: string | null;
    nomeFornecedor: string | null;
    intervaloFornecedorSeg: number | null;
    temComandoCorte: boolean;
    instaladoEm: string | null;
    ultimaPosicaoEm: string | null;
  } | null;
  sensores: SensorNaTela[];
  viagens: ViagemNaTela[];
  eventos: EventoNaTela[];
}

const TOM: Record<string, string> = {
  success: "border-success/30 bg-success/5",
  warning: "border-warning/30 bg-warning/5",
  danger: "border-destructive/30 bg-destructive/5",
};
const TOM_TXT: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function duracao(segundos: number): string {
  const m = Math.round(segundos / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export function VeiculoPage() {
  const { id = "" } = useParams();
  const [veiculo, setVeiculo] = useState<VeiculoFrota | null>(null);
  const [dia, setDia] = useState<DiaDoVeiculo | null>(null);
  const [trilha, setTrilha] = useState<{ lat: number; lng: number }[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [v, d, t] = await Promise.all([
        veiculosApi.obter(id),
        // Sem cliente proprio: e uma chamada so desta tela.
        (await import("@/lib/apiClient")).api.get<DiaDoVeiculo>(`/frota/veiculos/${id}/dia`),
        frotaMapaApi.trilha(id).catch(() => []),
      ]);
      setVeiculo(v);
      setDia(d);
      setTrilha(t);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Falha ao comunicar com o servidor");
    }
  }, [id]);

  useEffect(() => {
    void carregar();
    // 60s: nada aqui muda mais rapido que a coleta, que roda a cada minuto.
    const t = setInterval(() => void carregar(), 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  if (erro) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-5xl p-4 lg:p-6">
          <ErrorState message={erro} onRetry={() => void carregar()} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <AnimatedPage>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 lg:p-6">
          <div>
            <Link
              to="/frota/mapa"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Frota ao vivo
            </Link>
            <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tabular-nums">
              {veiculo ? (
                <>
                  <span aria-hidden>{EMOJI_VEICULO[veiculo.tipo]}</span>
                  {formatarPlaca(veiculo.placa)}
                  <span className="text-base font-normal text-muted-foreground">{veiculo.modelo}</span>
                </>
              ) : (
                <Skeleton className="h-6 w-40" />
              )}
            </h1>
          </div>

          {/* --- SENSORES: tudo o que o aparelho reporta, pelo vocabulario dele --- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="size-4 text-primary" aria-hidden />
                Sensores do rastreador
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dia === null ? (
                <Skeleton className="h-20 w-full" />
              ) : dia.rastreador === null ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum rastreador vinculado a este veículo.
                </p>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {dia.sensores.map((s) => (
                      <div
                        key={s.nome}
                        className={cn("rounded-lg border p-2.5", s.severidade ? TOM[s.severidade] : "border-border")}
                      >
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.rotulo}</p>
                        <p
                          className={cn(
                            "text-sm font-medium tabular-nums",
                            s.severidade ? TOM_TXT[s.severidade] : "text-foreground",
                          )}
                        >
                          {s.resumo}
                        </p>
                      </div>
                    ))}
                  </div>
                  {dia.sensores.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      O aparelho ainda não reportou nenhum sensor.
                    </p>
                  ) : null}

                  <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="flex justify-between gap-2">
                      <dt>Aparelho</dt>
                      <dd className="tabular-nums text-foreground">
                        {dia.rastreador.modeloFornecedor ?? "—"} · {dia.rastreador.identificadorExterno}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Envia a cada</dt>
                      <dd className="tabular-nums text-foreground">
                        {dia.rastreador.intervaloFornecedorSeg ? `${dia.rastreador.intervaloFornecedorSeg}s` : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Última posição</dt>
                      <dd className="text-foreground">
                        {dia.rastreador.ultimaPosicaoEm
                          ? idadeDaPosicao(dia.rastreador.ultimaPosicaoEm, new Date(dia.agoraServidor))
                          : "nunca"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Bloqueio de motor</dt>
                      {/*
                        Diz ONDE se faz, para ninguem procurar um botao que nao
                        existe. O ISPhub nao envia comando: quem bloqueia e a
                        plataforma do fornecedor, que ja tem o controle e a
                        responsabilidade.
                      */}
                      <dd className="text-foreground">
                        {dia.rastreador.temComandoCorte ? "aceita — pela plataforma do fornecedor" : "não aceita"}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* --- VIAGENS --- */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Route className="size-4 text-primary" aria-hidden />
                  Viagens (24h)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dia === null ? (
                  <Skeleton className="h-16 w-full" />
                ) : dia.viagens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma viagem registrada. Uma viagem começa quando a ignição liga.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {dia.viagens.map((v) => (
                      <li key={v.id} className="rounded-lg border border-border p-2.5 text-sm">
                        <p className="flex items-center justify-between gap-2 tabular-nums">
                          <span className="font-medium">
                            {hora(v.inicioEm)} → {v.fimEm ? hora(v.fimEm) : "em curso"}
                          </span>
                          <span>{v.distanciaMetros != null ? formatarDistancia(v.distanciaMetros) : "—"}</span>
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {v.velocidadeMaxKmh != null ? `máx ${Math.round(v.velocidadeMaxKmh)} km/h` : "—"}
                          {v.paradoComMotorLigadoSeg && v.paradoComMotorLigadoSeg >= 60
                            ? ` · ${duracao(v.paradoComMotorLigadoSeg)} parado com o motor ligado`
                            : ""}
                          {v.motorista ? ` · ${v.motorista}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {trilha.length > 1 ? (
                  <p className="mt-2 text-xs text-muted-foreground">{trilha.length} pontos no percurso de hoje.</p>
                ) : null}
              </CardContent>
            </Card>

            {/* --- EVENTOS --- */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Siren className="size-4 text-primary" aria-hidden />
                  O que mudou (24h)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dia === null ? (
                  <Skeleton className="h-16 w-full" />
                ) : dia.eventos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma mudança de estado registrada.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {dia.eventos.map((e) => (
                      <li key={e.id} className="flex items-baseline gap-2 text-sm">
                        <span className="tabular-nums text-muted-foreground">{hora(e.em)}</span>
                        <span>{EVENTO_RASTREADOR_ROTULO[e.tipo] ?? e.tipo}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </AnimatedPage>
    </AppShell>
  );
}
