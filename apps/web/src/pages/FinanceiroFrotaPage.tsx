import { useCallback, useEffect, useState } from "react";
import {
  COMBUSTIVEL_ROTULO,
  MOVIMENTO_CARTAO_ROTULO,
  MOVIMENTO_CARTAO_TIPOS,
  TIPOS_COMBUSTIVEL,
  formatarConsumo,
  formatarDataIso,
  formatarMoeda,
  hojeIso,
  normalizarValor,
  paraCentavos,
  type AbastecimentoPublic,
  type CartaoPublic,
  type MovimentoCartaoTipo,
  type TipoCombustivel,
  type VeiculoPublic,
} from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
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
import { FinanceiroTabs } from "@/components/financeiro/FinanceiroTabs";
import { frotaApi } from "@/lib/financeiroApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { Fuel, Plus } from "lucide-react";

type Sub = "abastecimentos" | "cartoes";

/**
 * FROTA — abastecimentos e cartão-combustível.
 *
 * Cada abastecimento gera a despesa no financeiro na mesma transação, e o
 * consumo (km/l) é medido de tanque cheio a tanque cheio — o único intervalo em
 * que a conta fecha.
 */
export function FinanceiroFrotaPage() {
  const { toast } = useToast();
  const [sub, setSub] = useState<Sub>("abastecimentos");
  const [veiculos, setVeiculos] = useState<VeiculoPublic[]>([]);
  const [abastecimentos, setAbastecimentos] = useState<AbastecimentoPublic[]>([]);
  const [cartoes, setCartoes] = useState<CartaoPublic[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [dialogo, setDialogo] = useState<"veiculo" | "abastecimento" | "cartao" | null>(null);
  const [movimentando, setMovimentando] = useState<CartaoPublic | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [v, a, c] = await Promise.all([frotaApi.veiculos(), frotaApi.abastecimentos(), frotaApi.cartoes()]);
      setVeiculos(v);
      setAbastecimentos(a);
      setCartoes(c);
    } catch (err) {
      toast({
        titulo: "Não deu para carregar a frota",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    } finally {
      setCarregando(false);
    }
  }, [toast]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Frota — cada abastecimento vira uma despesa; o consumo sai de tanque cheio a tanque cheio.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDialogo("veiculo")}>
                <Plus className="size-4" aria-hidden />
                Veículo
              </Button>
              <Button
                onClick={() => setDialogo(sub === "cartoes" ? "cartao" : "abastecimento")}
                disabled={sub === "abastecimentos" && veiculos.length === 0}
              >
                <Plus className="size-4" aria-hidden />
                {sub === "cartoes" ? "Cartão" : "Abastecimento"}
              </Button>
            </div>
          </div>
          <FinanceiroTabs atual="frota" />
        </header>

        <div role="tablist" aria-label="Seção da frota" className="flex gap-1.5">
          {(["abastecimentos", "cartoes"] as Sub[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={sub === s}
              onClick={() => setSub(s)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:min-h-11",
                sub === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "abastecimentos" ? "Abastecimentos" : "Cartões"}
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : sub === "abastecimentos" ? (
          <ListaAbastecimentos itens={abastecimentos} semVeiculo={veiculos.length === 0} />
        ) : (
          <ListaCartoes itens={cartoes} onMovimentar={setMovimentando} />
        )}
      </div>

      <VeiculoDialog
        aberto={dialogo === "veiculo"}
        onFechar={() => setDialogo(null)}
        onSalvo={async () => {
          setDialogo(null);
          await carregar();
        }}
      />
      <AbastecimentoDialog
        aberto={dialogo === "abastecimento"}
        veiculos={veiculos}
        onFechar={() => setDialogo(null)}
        onSalvo={async () => {
          setDialogo(null);
          await carregar();
        }}
      />
      <CartaoDialog
        aberto={dialogo === "cartao"}
        onFechar={() => setDialogo(null)}
        onSalvo={async () => {
          setDialogo(null);
          await carregar();
        }}
      />
      <MovimentoDialog
        cartao={movimentando}
        onFechar={() => setMovimentando(null)}
        onSalvo={async () => {
          setMovimentando(null);
          await carregar();
        }}
      />
    </AppShell>
  );
}

function ListaAbastecimentos({ itens, semVeiculo }: { itens: AbastecimentoPublic[]; semVeiculo: boolean }) {
  if (semVeiculo) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Cadastre um veículo primeiro — o abastecimento pertence a um.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (itens.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Nenhum abastecimento registrado.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Abastecimentos">
      {itens.map((a) => (
        <li key={a.id}>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <Fuel className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="font-mono text-sm font-medium">{a.veiculoPlaca}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>{formatarDataIso(a.data)}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{a.km.toLocaleString("pt-BR")} km</span>
                  <span aria-hidden>·</span>
                  <span>{a.litros} L</span>
                  <span aria-hidden>·</span>
                  <span>{COMBUSTIVEL_ROTULO[a.combustivel]}</span>
                  {!a.tanqueCheio && (
                    <>
                      <span aria-hidden>·</span>
                      <span title="Sem tanque cheio não dá para medir consumo">parcial</span>
                    </>
                  )}
                  {a.posto && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{a.posto}</span>
                    </>
                  )}
                </p>
              </div>
              <span
                className="font-mono text-sm tabular-nums text-muted-foreground"
                title="km por litro desde o último tanque cheio"
              >
                {formatarConsumo(a.consumo)}
              </span>
              <span className="font-mono text-base font-semibold tabular-nums">
                {formatarMoeda(a.valorTotal)}
              </span>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function ListaCartoes({
  itens,
  onMovimentar,
}: {
  itens: CartaoPublic[];
  onMovimentar: (c: CartaoPublic) => void;
}) {
  if (itens.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Nenhum cartão cadastrado.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Cartões">
      {itens.map((c) => {
        const negativo = paraCentavos(c.saldo) < 0;
        return (
          <li key={c.id}>
            <Card className={cn(!c.ativo && "opacity-60")}>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <span className="font-mono text-sm font-medium">{c.numero}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {c.titularNome ?? "Sem titular"} · {c.totalMovimentos} movimento(s)
                  </p>
                </div>
                <span
                  className={cn(
                    "font-mono text-base font-semibold tabular-nums",
                    negativo && "text-destructive",
                  )}
                  title="Soma dos movimentos — não há coluna de saldo"
                >
                  {formatarMoeda(c.saldo)}
                </span>
                <Button size="sm" variant="secondary" onClick={() => onMovimentar(c)}>
                  Movimentar
                </Button>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------

function VeiculoDialog({
  aberto,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const [placa, setPlaca] = useState("");
  const [modelo, setModelo] = useState("");
  const [ano, setAno] = useState("");

  useEffect(() => {
    if (aberto) {
      setPlaca("");
      setModelo("");
      setAno("");
    }
  }, [aberto]);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo veículo</DialogTitle>
          <DialogDescription>O abastecimento pertence a um veículo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vei-placa">Placa</Label>
            <Input
              id="vei-placa"
              value={placa}
              onChange={(e) => setPlaca(e.target.value.toUpperCase())}
              maxLength={10}
              placeholder="ABC1D23"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vei-modelo">Modelo</Label>
              <Input id="vei-modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vei-ano">Ano</Label>
              <Input id="vei-ano" type="number" value={ano} onChange={(e) => setAno(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={placa.trim().length < 5 || !modelo.trim()}
            onClick={async () => {
              try {
                await frotaApi.criarVeiculo({
                  placa: placa.trim(),
                  modelo: modelo.trim(),
                  ano: ano ? Number(ano) : null,
                });
                toast({ titulo: "Veículo cadastrado", variante: "sucesso" });
                onSalvo();
              } catch (err) {
                toast({
                  titulo: "Não deu para cadastrar",
                  descricao: err instanceof ApiError ? err.message : undefined,
                  variante: "erro",
                });
              }
            }}
          >
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AbastecimentoDialog({
  aberto,
  veiculos,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  veiculos: VeiculoPublic[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const [veiculoId, setVeiculoId] = useState("");
  const [data, setData] = useState(hojeIso());
  const [km, setKm] = useState("");
  const [litros, setLitros] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [combustivel, setCombustivel] = useState<TipoCombustivel>("gasolina");
  const [posto, setPosto] = useState("");
  const [tanqueCheio, setTanqueCheio] = useState(true);

  useEffect(() => {
    if (!aberto) return;
    /*
     * So pre-seleciona quando ha UM veiculo. Com varios, o primeiro da ordem
     * alfabetica e uma escolha arbitraria — e registrar combustivel no carro
     * errado nao da erro nenhum, so estraga o km/l dos dois em silencio.
     */
    setVeiculoId(veiculos.length === 1 ? veiculos[0].id : "");
    setData(hojeIso());
    setKm("");
    setLitros("");
    setValorTotal("");
    setCombustivel("gasolina");
    setPosto("");
    setTanqueCheio(true);
  }, [aberto, veiculos]);

  const veiculo = veiculos.find((v) => v.id === veiculoId);
  const valorOk = !!normalizarValor(valorTotal || "");
  const kmNum = Number(km);
  const kmOk = Number.isInteger(kmNum) && kmNum >= 0;
  // O odômetro não anda para trás — avisar aqui evita o 400 do servidor.
  const kmRetrocede = kmOk && veiculo?.ultimoKm != null && kmNum < veiculo.ultimoKm;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo abastecimento</DialogTitle>
          <DialogDescription>Gera a despesa no financeiro automaticamente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ab-veiculo">Veículo</Label>
              <Select
                id="ab-veiculo"
                className="w-full"
                value={veiculoId}
                onChange={(e) => setVeiculoId(e.target.value)}
              >
                {veiculos.length !== 1 && <option value="">Selecione o veículo</option>}
                {veiculos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.placa} — {v.modelo}
                  </option>
                ))}
              </Select>
              {veiculo?.ultimoKm != null && (
                <p className="text-xs text-muted-foreground">
                  Último: {veiculo.ultimoKm.toLocaleString("pt-BR")} km
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ab-data">Data</Label>
              <Input id="ab-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ab-km">Odômetro</Label>
              <Input
                id="ab-km"
                type="number"
                inputMode="numeric"
                value={km}
                onChange={(e) => setKm(e.target.value)}
                aria-invalid={kmRetrocede}
              />
              {kmRetrocede && (
                <p role="alert" className="text-xs text-destructive">
                  Menor que o último.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ab-litros">Litros</Label>
              <Input
                id="ab-litros"
                inputMode="decimal"
                value={litros}
                onChange={(e) => setLitros(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ab-valor">Valor</Label>
              <Input
                id="ab-valor"
                inputMode="decimal"
                placeholder="0,00"
                value={valorTotal}
                onChange={(e) => setValorTotal(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ab-comb">Combustível</Label>
              <Select
                id="ab-comb"
                className="w-full"
                value={combustivel}
                onChange={(e) => setCombustivel(e.target.value as TipoCombustivel)}
              >
                {TIPOS_COMBUSTIVEL.map((t) => (
                  <option key={t} value={t}>
                    {COMBUSTIVEL_ROTULO[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ab-posto">Posto</Label>
              <Input id="ab-posto" value={posto} onChange={(e) => setPosto(e.target.value)} maxLength={120} />
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
            <input
              id="ab-cheio"
              type="checkbox"
              checked={tanqueCheio}
              onChange={(e) => setTanqueCheio(e.target.checked)}
              className="size-4 accent-primary"
            />
            <label htmlFor="ab-cheio" className="text-sm">
              Encheu o tanque
            </label>
            <span className="ml-auto text-xs text-muted-foreground">
              {tanqueCheio ? "O km/l é medido entre cheios." : "Sem tanque cheio o consumo fica em branco."}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!veiculoId || !kmOk || kmRetrocede || !litros.trim() || !valorOk}
            onClick={async () => {
              try {
                await frotaApi.registrarAbastecimento({
                  veiculoId,
                  data,
                  km: kmNum,
                  litros: litros.trim(),
                  valorTotal: normalizarValor(valorTotal)!,
                  combustivel,
                  posto: posto.trim() || null,
                  tanqueCheio,
                });
                toast({ titulo: "Abastecimento registrado", descricao: "A despesa foi lançada.", variante: "sucesso" });
                onSalvo();
              } catch (err) {
                toast({
                  titulo: "Não deu para registrar",
                  descricao: err instanceof ApiError ? err.message : undefined,
                  variante: "erro",
                });
              }
            }}
          >
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CartaoDialog({
  aberto,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const [numero, setNumero] = useState("");

  useEffect(() => {
    if (aberto) setNumero("");
  }, [aberto]);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo cartão-combustível</DialogTitle>
          <DialogDescription>O saldo é a soma dos movimentos, não um campo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cart-numero">Número</Label>
          <Input id="cart-numero" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={40} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!numero.trim()}
            onClick={async () => {
              try {
                await frotaApi.criarCartao({ numero: numero.trim() });
                toast({ titulo: "Cartão cadastrado", variante: "sucesso" });
                onSalvo();
              } catch (err) {
                toast({
                  titulo: "Não deu para cadastrar",
                  descricao: err instanceof ApiError ? err.message : undefined,
                  variante: "erro",
                });
              }
            }}
          >
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovimentoDialog({
  cartao,
  onFechar,
  onSalvo,
}: {
  cartao: CartaoPublic | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const [tipo, setTipo] = useState<MovimentoCartaoTipo>("deposito");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hojeIso());
  const [descricao, setDescricao] = useState("");
  // Mantém montado durante o fechamento — desmontar com `open` ainda true deixa
  // aria-hidden e pointer-events pendurados no documento.
  const [ultimo, setUltimo] = useState<CartaoPublic | null>(cartao);

  useEffect(() => {
    if (cartao) {
      setUltimo(cartao);
      setTipo("deposito");
      setValor("");
      setData(hojeIso());
      setDescricao("");
    }
  }, [cartao]);

  const dados = cartao ?? ultimo;
  if (!dados) return null;

  return (
    <Dialog open={!!cartao} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Movimentar {dados.numero}</DialogTitle>
          <DialogDescription>Saldo atual: {formatarMoeda(dados.saldo)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mov-tipo">Tipo</Label>
              <Select
                id="mov-tipo"
                className="w-full"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as MovimentoCartaoTipo)}
              >
                {MOVIMENTO_CARTAO_TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {MOVIMENTO_CARTAO_ROTULO[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mov-valor">Valor</Label>
              <Input
                id="mov-valor"
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Sempre positivo — o sinal vem do tipo.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mov-data">Data</Label>
              <Input id="mov-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mov-desc">Descrição</Label>
              <Input id="mov-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={200} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!normalizarValor(valor || "")}
            onClick={async () => {
              try {
                await frotaApi.movimentar(dados.id, {
                  tipo,
                  valor: normalizarValor(valor)!,
                  data,
                  descricao: descricao.trim() || null,
                });
                toast({ titulo: "Movimento registrado", variante: "sucesso" });
                onSalvo();
              } catch (err) {
                toast({
                  titulo: "Não deu para registrar",
                  descricao: err instanceof ApiError ? err.message : undefined,
                  variante: "erro",
                });
              }
            }}
          >
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
