import { useCallback, useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import { Plus, Truck } from "lucide-react";

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
  const [veiculos, setVeiculos] = useState<VeiculoFrota[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<VeiculoFrota | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setVeiculos(await veiculosApi.listar());
    } catch (e) {
      setErro(mensagem(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

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
            <Button onClick={() => setCriando(true)}>
              <Plus className="size-4" aria-hidden />
              Novo veículo
            </Button>
          </header>

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
                    onClick={() => setEditando(v)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        {/* tabular-nums: a placa e alfanumerica de largura fixa —
                            sem isso a coluna dança entre linhas. */}
                        <span className="font-semibold tabular-nums">{v.placaFormatada}</span>
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
  const [odometro, setOdometro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Repovoa a cada abertura. Sem isto, editar um segundo veiculo mostraria os
  // campos do primeiro — o dialogo e uma instancia so, montada uma vez.
  useEffect(() => {
    if (!aberto) return;
    setPlaca(veiculo?.placaFormatada ?? "");
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
        modelo: modelo.trim(),
        marca: marca.trim() || null,
        ano: ano.trim() ? Number(ano) : null,
        cor: cor.trim() || null,
        tipo,
        odometroKm: odometro.trim() ? Number(odometro) : null,
      };
      if (veiculo) {
        await veiculosApi.editar(veiculo.id, { ...dados, status });
        onSalvo(`${veiculo.placaFormatada} atualizado`);
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
          <DialogTitle>{veiculo ? `Editar ${veiculo.placaFormatada}` : "Novo veículo"}</DialogTitle>
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
