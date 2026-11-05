import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { manutencaoApi, checklistApi, type ChecklistResumo, type PlanoComEstado } from "@/lib/veiculosApi";
import { api } from "@/lib/apiClient";
import {
  STATUS_VEICULO,
  STATUS_VEICULO_ROTULO,
  TIPOS_VEICULO,
  TIPO_VEICULO_ROTULO,
  formatarPlaca,
  normalizarPlaca,
  placaValida,
  type StatusVeiculo,
  type TipoVeiculo,
} from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ErrorState";
import { veiculosApi, type VeiculoFrota, type VeiculoInput } from "@/lib/veiculosApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { usePodeEditar } from "@/context/AuthContext";
import { AvisoSoVer } from "@/components/AvisoSoVer";
import { cn } from "@/lib/utils";
import { Link, useNavigate } from "react-router-dom";
import { Download, KeyRound, Map as MapIcon, Plus, Truck } from "lucide-react";
import { ImportarRastreadoresDialog } from "@/components/frota/ImportarRastreadoresDialog";
import { CredencialRastreamentoDialog } from "@/components/frota/CredencialRastreamentoDialog";

/**
 * FROTA — cadastro de veiculos.
 *
 * Primeira tela do modulo. O que ela faz de diferente do cadastro que ja existia
 * sob /financeiro/frota: o veiculo tem DONO (provedor, ou a propria operacao) e
 * tem SITUACAO operacional, e a placa e normalizada de verdade.
 *
 * O que ela ainda NAO mostra — quem esta na viatura agora, onde ela esta — e a
 * fatia seguinte. A tabela de ocupacao ja existe no banco, vazia.
 *
 * Sem react-query de proposito: `lib/modulos.ts` documenta a queda de producao
 * causada por um `useQuery` sem QueryClient no provider da web. Aqui e
 * useState/useEffect, como no resto do app.
 */

const CORES_STATUS: Record<StatusVeiculo, string> = {
  ativo: "bg-success/15 text-success",
  manutencao: "bg-warning/15 text-warning",
  inativo: "bg-muted text-muted-foreground",
};

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

function Badge({ status }: { status: StatusVeiculo }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", CORES_STATUS[status])}>
      {STATUS_VEICULO_ROTULO[status]}
    </span>
  );
}

export function FrotaVeiculosPage() {
  const { toast } = useToast();
  // Supervisor com a frota so em "ver": sem cadastro, importacao nem credencial;
  // o clique no carro abre a pagina dele (leitura) em vez do formulario.
  const podeEditar = usePodeEditar("frota");
  const navigate = useNavigate();
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<VeiculoFrota | null>(null);
  const [criando, setCriando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [credencial, setCredencial] = useState(false);

  const lista = useQuery({ queryKey: ["frota", "veiculos"], queryFn: () => veiculosApi.listar() });
  const veiculos = lista.data ?? null;
  const erro = lista.error ? mensagem(lista.error) : null;
  const carregar = useCallback(() => lista.refetch(), [lista]);

  /*
   * Busca compara a placa NORMALIZADA: quem digita "abc-1234" tem de achar o
   * carro gravado como "ABC1234". Sem isso a busca falha exatamente no formato
   * que a pessoa le na tela (que e o formatado, com hifen).
   */
  const termo = busca.trim().toUpperCase();
  const termoPlaca = normalizarPlaca(busca);
  const filtrados = (veiculos ?? []).filter(
    (v) =>
      !termo ||
      (termoPlaca.length > 0 && v.placa.includes(termoPlaca)) ||
      v.modelo.toUpperCase().includes(termo) ||
      (v.marca ?? "").toUpperCase().includes(termo),
  );

  return (
    <AppShell>
      <AnimatedPage>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 lg:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold">
                <Truck className="size-5 text-primary" aria-hidden />
                Frota
              </h1>
              <p className="text-sm text-muted-foreground">Veículos da operação e dos provedores.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" asChild>
                <Link to="/frota/mapa">
                  <MapIcon className="size-4" aria-hidden />
                  Ver no mapa
                </Link>
              </Button>
              {/*
                Importar fica ao lado de "Novo veículo" porque e a MESMA
                intencao — pôr carro na frota — por outro caminho: um a um na
                mão, ou de uma vez a partir de quem ja tem aparelho instalado.
              */}
              {podeEditar ? (
              <>
              <Button variant="ghost" onClick={() => setCredencial(true)}>
                <KeyRound className="size-4" aria-hidden />
                Credencial
              </Button>
              <Button variant="ghost" onClick={() => setImportando(true)}>
                <Download className="size-4" aria-hidden />
                Importar da PlataformaTK
              </Button>
              <Button onClick={() => setCriando(true)}>
                <Plus className="size-4" aria-hidden />
                Novo veículo
              </Button>
              </>
              ) : null}
            </div>
          </header>

          {podeEditar ? null : <AvisoSoVer />}

          <Input
            aria-label="Buscar veículo"
            placeholder="Placa, marca ou modelo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="max-w-sm"
          />

          {erro ? (
            <ErrorState message={erro} onRetry={() => void carregar()} />
          ) : veiculos === null ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filtrados.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                {veiculos.length === 0
                  ? "Nenhum veículo cadastrado ainda."
                  : "Nenhum veículo encontrado para essa busca."}
              </CardContent>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtrados.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => (podeEditar ? setEditando(v) : navigate(`/frota/veiculos/${v.id}`))}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        {/* tabular-nums: a placa e alfanumerica de largura fixa —
                            sem isso a coluna dança entre linhas. */}
                        <span className="font-semibold tabular-nums">{v.rotulo}</span>
                        <Badge status={v.status} />
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {[v.marca, v.modelo, v.ano].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="hidden text-right text-xs text-muted-foreground sm:block">
                      <p>{TIPO_VEICULO_ROTULO[v.tipo]}</p>
                      {/*
                        Dono. "Operação" e resposta, nao lacuna: e o carro da
                        propria ISPhub, que atende varios provedores.
                      */}
                      <p>{v.provedorNome ?? "Operação"}</p>
                    </div>
                    <span className="w-24 text-right text-sm tabular-nums">
                      {v.odometroKm != null ? `${v.odometroKm.toLocaleString("pt-BR")} km` : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AnimatedPage>

      <DialogVeiculo
        aberto={criando || editando !== null}
        veiculo={editando}
        onFechar={() => {
          setCriando(false);
          setEditando(null);
        }}
        onSalvo={(msg) => {
          toast({ titulo: msg, variante: "sucesso" });
          setCriando(false);
          setEditando(null);
          void carregar();
        }}
      />
      <CredencialRastreamentoDialog aberto={credencial} aoFechar={() => setCredencial(false)} />
      <ImportarRastreadoresDialog
        aberto={importando}
        aoFechar={() => setImportando(false)}
        aoImportar={() => void carregar()}
      />
    </AppShell>
  );
}

function DialogVeiculo({
  aberto,
  veiculo,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  veiculo: VeiculoFrota | null;
  onFechar: () => void;
  onSalvo: (mensagem: string) => void;
}) {
  const { toast } = useToast();
  const [placa, setPlaca] = useState("");
  const [modelo, setModelo] = useState("");
  const [marca, setMarca] = useState("");
  const [ano, setAno] = useState("");
  const [cor, setCor] = useState("");
  const [tipo, setTipo] = useState<TipoVeiculo>("carro");
  const [status, setStatus] = useState<StatusVeiculo>("ativo");
  const [apelido, setApelido] = useState("");
  const [odometro, setOdometro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Repovoa a cada abertura. Sem isto, editar um segundo veiculo mostraria os
  // campos do primeiro — o dialogo e uma instancia so, montada uma vez.
  useEffect(() => {
    if (!aberto) return;
    setPlaca(veiculo?.placaFormatada ?? "");
    setApelido(veiculo?.apelido ?? "");
    setModelo(veiculo?.modelo ?? "");
    setMarca(veiculo?.marca ?? "");
    setAno(veiculo?.ano ? String(veiculo.ano) : "");
    setCor(veiculo?.cor ?? "");
    setTipo(veiculo?.tipo ?? "carro");
    setStatus(veiculo?.status ?? "ativo");
    setOdometro(veiculo?.odometroKm != null ? String(veiculo.odometroKm) : "");
  }, [aberto, veiculo]);

  const placaCanonica = normalizarPlaca(placa);
  const placaOk = placaValida(placaCanonica);
  const podeSalvar = modelo.trim().length > 0 && (veiculo !== null || placaOk);

  async function salvar() {
    setSalvando(true);
    try {
      const dados: VeiculoInput = {
        apelido: apelido.trim() || null,
        modelo: modelo.trim(),
        marca: marca.trim() || null,
        ano: ano.trim() ? Number(ano) : null,
        cor: cor.trim() || null,
        tipo,
        odometroKm: odometro.trim() ? Number(odometro) : null,
      };
      if (veiculo) {
        await veiculosApi.editar(veiculo.id, { ...dados, status });
        onSalvo(`${veiculo.rotulo} atualizado`);
      } else {
        await veiculosApi.criar({ ...dados, placa: placaCanonica });
        onSalvo(`${formatarPlaca(placaCanonica)} cadastrado`);
      }
    } catch (e) {
      toast({ titulo: "Não foi possível salvar", descricao: mensagem(e), variante: "erro" });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{veiculo ? `Editar ${veiculo.rotulo}` : "Novo veículo"}</DialogTitle>
          <DialogDescription>
            {veiculo
              ? "A placa não muda: ela identifica o veículo no histórico inteiro."
              : "A placa aceita os dois formatos — AAA1234 e Mercosul ABC1D23."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {/*
            Na edicao a placa e so leitura. Trocar a placa de um veiculo
            existente nao e "corrigir": e dizer que todo o historico de
            abastecimento, ocupacao e posicao pertence a outro carro.
          */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="placa">Placa</Label>
            <Input
              id="placa"
              value={placa}
              disabled={veiculo !== null}
              onChange={(e) => setPlaca(e.target.value)}
              placeholder="HFX-3652"
              className="tabular-nums"
            />
            {!veiculo && placa.trim().length > 0 && !placaOk ? (
              <p className="mt-1 text-xs text-destructive">
                Placa inválida. Use AAA1234 ou ABC1D23 — hífen e espaço podem ficar.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="marca">Marca</Label>
            <Input id="marca" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Fiat" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apelido">Apelido</Label>
            <Input
              id="apelido"
              value={apelido}
              onChange={(e) => setApelido(e.target.value)}
              placeholder="C011"
              maxLength={40}
            />
            <p className="text-xs text-muted-foreground">
              Como a equipe chama este carro. Aparece na frente da placa no mapa e nas listas.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="modelo">Modelo</Label>
            <Input id="modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Uno" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ano">Ano</Label>
            <Input
              id="ano"
              inputMode="numeric"
              value={ano}
              onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cor">Cor</Label>
            <Input id="cor" value={cor} onChange={(e) => setCor(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tipo">Tipo</Label>
            <Select id="tipo" className="w-full" value={tipo} onChange={(e) => setTipo(e.target.value as TipoVeiculo)}>
              {TIPOS_VEICULO.map((t) => (
                <option key={t} value={t}>
                  {TIPO_VEICULO_ROTULO[t]}
                </option>
              ))}
            </Select>
          </div>

          {veiculo ? (
            <div>
              <Label htmlFor="status">Situação</Label>
              <Select id="status" className="w-full" value={status} onChange={(e) => setStatus(e.target.value as StatusVeiculo)}>
                {STATUS_VEICULO.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_VEICULO_ROTULO[s]}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="odometro">Odômetro (km)</Label>
            <Input
              id="odometro"
              inputMode="numeric"
              value={odometro}
              onChange={(e) => setOdometro(e.target.value.replace(/\D/g, "").slice(0, 7))}
              className="tabular-nums"
            />
            {/*
              O servidor recusa retrocesso, e a tela precisa dizer isso ANTES —
              senao a pessoa salva, o numero nao muda e parece bug.
            */}
            {veiculo?.odometroKm != null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Só aumenta. Atual: {veiculo.odometroKm.toLocaleString("pt-BR")} km.
              </p>
            ) : null}
          </div>
        </div>

        {veiculo ? (
          <>
            <ManutencaoDoVeiculo veiculoId={veiculo.id} />
            <ChecklistsDoVeiculo veiculoId={veiculo.id} />
          </>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={!podeSalvar || salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


const SITUACAO_ROTULO = { ok: "em dia", vence_em_breve: "vence em breve", vencida: "vencida", sem_base: "sem base" } as const;
const SITUACAO_TOM = {
  ok: "bg-success/10 text-success",
  vence_em_breve: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  vencida: "bg-destructive/10 text-destructive",
  sem_base: "bg-secondary text-muted-foreground",
} as const;

/**
 * Manutencao preventiva do veiculo: cada plano com o que falta (km/dias) e o
 * botao "Feita". O odometro atual e a MAIOR leitura que o sistema tem
 * (cadastro, abastecimento, checklist) — o checklist da saida e o que o mantem
 * vivo, ja que o rastreador nao tem odometro.
 */
function ManutencaoDoVeiculo({ veiculoId }: { veiculoId: string }) {
  const { toast } = useToast();
  const [dados, setDados] = useState<{ odometroKm: number | null; planos: PlanoComEstado[] } | null>(null);
  const [tipo, setTipo] = useState("");
  const [intervaloKm, setIntervaloKm] = useState("");
  const [intervaloDias, setIntervaloDias] = useState("");
  const [ultimaKm, setUltimaKm] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    manutencaoApi
      .listar(veiculoId)
      .then(setDados)
      .catch((e) => toast({ titulo: "Não foi possível carregar a manutenção", descricao: mensagem(e), variante: "erro" }));
  }, [veiculoId, toast]);
  useEffect(carregar, [carregar]);

  async function criar() {
    setSalvando(true);
    try {
      setDados(
        await manutencaoApi.criar(veiculoId, {
          tipo: tipo.trim(),
          intervaloKm: intervaloKm ? Number(intervaloKm) : null,
          intervaloDias: intervaloDias ? Number(intervaloDias) : null,
          ultimaKm: ultimaKm ? Number(ultimaKm) : null,
        }),
      );
      setTipo("");
      setIntervaloKm("");
      setIntervaloDias("");
      setUltimaKm("");
    } catch (e) {
      toast({ titulo: "Não foi possível criar o plano", descricao: mensagem(e), variante: "erro" });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Manutenção preventiva</p>
        <span className="text-xs text-muted-foreground">
          odômetro atual: {dados?.odometroKm != null ? `${dados.odometroKm.toLocaleString("pt-BR")} km` : "sem leitura"}
        </span>
      </div>
      {dados === null ? (
        <Skeleton className="h-8 w-full" />
      ) : dados.planos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum plano. Cadastre abaixo (ex.: Troca de óleo a cada 10.000 km).</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {dados.planos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 font-medium">{p.tipo}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SITUACAO_TOM[p.estado.situacao]}`}>{SITUACAO_ROTULO[p.estado.situacao]}</span>
              <span className="text-xs text-muted-foreground">
                {p.estado.restanteKm != null ? `${p.estado.restanteKm >= 0 ? "faltam" : "passou"} ${Math.abs(p.estado.restanteKm).toLocaleString("pt-BR")} km` : ""}
                {p.estado.restanteKm != null && p.estado.restanteDias != null ? " · " : ""}
                {p.estado.restanteDias != null ? `${p.estado.restanteDias >= 0 ? "faltam" : "passou"} ${Math.abs(p.estado.restanteDias)} dias` : ""}
              </span>
              <Button variant="outline" size="sm" onClick={() => void manutencaoApi.concluir(p.id).then(setDados).catch((e) => toast({ titulo: "Não foi possível marcar", descricao: mensagem(e), variante: "erro" }))}>
                Feita
              </Button>
              <button type="button" onClick={() => void manutencaoApi.remover(p.id).then(carregar)} className="text-xs text-muted-foreground hover:text-destructive" aria-label={`Remover ${p.tipo}`}>
                remover
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Tipo (óleo, pneus…)" aria-label="Tipo de manutenção" className="col-span-2" />
        <Input value={intervaloKm} onChange={(e) => setIntervaloKm(e.target.value)} placeholder="a cada km" inputMode="numeric" aria-label="Intervalo em km" />
        <Input value={intervaloDias} onChange={(e) => setIntervaloDias(e.target.value)} placeholder="a cada dias" inputMode="numeric" aria-label="Intervalo em dias" />
        <Input value={ultimaKm} onChange={(e) => setUltimaKm(e.target.value)} placeholder="última em km" inputMode="numeric" aria-label="Km da última" />
      </div>
      <Button variant="outline" size="sm" className="w-fit" disabled={salvando || tipo.trim().length < 2 || (!intervaloKm && !intervaloDias)} onClick={() => void criar()}>
        {salvando ? "Salvando…" : "Adicionar plano"}
      </Button>
    </section>
  );
}

/** Os ultimos checklists (saida/retorno) da viatura: km, combustivel, avarias e a foto do painel. */
function ChecklistsDoVeiculo({ veiculoId }: { veiculoId: string }) {
  const [itens, setItens] = useState<ChecklistResumo[] | null>(null);
  useEffect(() => {
    checklistApi.listar(veiculoId).then(setItens).catch(() => setItens([]));
  }, [veiculoId]);
  if (itens === null) return <Skeleton className="h-8 w-full" />;
  if (itens.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Checklists (30 dias)</p>
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        {itens.slice(0, 10).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.momento === "saida" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
              {c.momento === "saida" ? "Saída" : "Retorno"}
            </span>
            <span className="text-xs text-muted-foreground">{new Date(c.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            <span className="min-w-0 flex-1 truncate text-xs">{c.usuarioNome}</span>
            <span className="tabular-nums">{c.odometroKm != null ? `${c.odometroKm.toLocaleString("pt-BR")} km` : "—"}</span>
            {c.combustivelPct != null ? <span className="text-xs text-muted-foreground">⛽ {c.combustivelPct}%</span> : null}
            {c.avarias ? <span className="text-xs text-destructive" title={c.avarias}>avarias</span> : null}
            {c.temFoto ? (
              // <a href> nao manda Authorization: baixa o blob autenticado e abre numa aba.
              <button
                type="button"
                onClick={() =>
                  void api.getBlob(checklistApi.urlFoto(c.id)).then((b) => {
                    const url = URL.createObjectURL(b);
                    window.open(url, "_blank", "noopener");
                    setTimeout(() => URL.revokeObjectURL(url), 60_000);
                  })
                }
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                foto
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
