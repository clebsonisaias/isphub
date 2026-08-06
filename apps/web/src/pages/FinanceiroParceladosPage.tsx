import { useCallback, useEffect, useMemo, useState } from "react";
import {
  descricaoParcela,
  dividirEmParcelas,
  formatarDataIso,
  formatarMoeda,
  hojeIso,
  normalizarValor,
  type CategoriaFinanceiraPublic,
  type LancamentoPublic,
  type LancamentoTipo,
  type ParcelamentoPublic,
  type Provedor,
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
import { financeiroApi, parcelamentoApi } from "@/lib/financeiroApi";
import { provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { Plus } from "lucide-react";

/**
 * PARCELADOS — compra dividida em N vezes.
 *
 * Diferente da recorrência: total e número de parcelas já são conhecidos, então
 * todas nascem de uma vez. Cada parcela é um lançamento normal na aba
 * Lançamentos, com baixa e comprovante próprios.
 */
export function FinanceiroParceladosPage() {
  const { toast } = useToast();
  const [itens, setItens] = useState<ParcelamentoPublic[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoAberto, setNovoAberto] = useState(false);
  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [categorias, setCategorias] = useState<CategoriaFinanceiraPublic[]>([]);
  const [detalhe, setDetalhe] = useState<{ p: ParcelamentoPublic; parcelas: LancamentoPublic[] } | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setItens(await parcelamentoApi.listar());
    } catch (err) {
      toast({
        titulo: "Não deu para carregar",
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

  useEffect(() => {
    void provedoresApi.listar().then(setProvedores).catch(() => setProvedores([]));
    void financeiroApi.categorias().then(setCategorias).catch(() => setCategorias([]));
  }, []);

  async function abrir(p: ParcelamentoPublic) {
    try {
      setDetalhe({ p, parcelas: await parcelamentoApi.parcelas(p.id) });
    } catch {
      toast({ titulo: "Não deu para abrir as parcelas", variante: "erro" });
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Parcelados — uma compra dividida em vezes. A soma das parcelas fecha exatamente no total.
              </p>
            </div>
            <Button onClick={() => setNovoAberto(true)}>
              <Plus className="size-4" aria-hidden />
              Novo parcelamento
            </Button>
          </div>
          <FinanceiroTabs atual="parcelados" />
        </header>

        {carregando ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : itens.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma compra parcelada ainda.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2" aria-label="Parcelamentos">
            {itens.map((p) => (
              <li key={p.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => abrir(p)}
                        className="max-w-full truncate text-left font-medium underline-offset-2 hover:underline"
                      >
                        {p.descricao}
                      </button>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{p.quantidade}x</span>
                        <span aria-hidden>·</span>
                        <span>1ª em {formatarDataIso(p.primeiroVencimento)}</span>
                        {p.categoriaNome && (
                          <>
                            <span aria-hidden>·</span>
                            <span>{p.categoriaNome}</span>
                          </>
                        )}
                        <span aria-hidden>·</span>
                        <span>
                          {p.parcelasPagas} de {p.quantidade} paga(s)
                        </span>
                      </p>
                    </div>
                    <span className="font-mono text-base font-semibold tabular-nums">
                      {formatarMoeda(p.valorTotal)}
                    </span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NovoParcelamentoDialog
        aberto={novoAberto}
        provedores={provedores}
        categorias={categorias}
        onFechar={() => setNovoAberto(false)}
        onCriado={async () => {
          setNovoAberto(false);
          await carregar();
        }}
      />

      <Dialog open={!!detalhe} onOpenChange={(o) => !o && setDetalhe(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detalhe?.p.descricao}</DialogTitle>
            <DialogDescription>
              {detalhe && `${detalhe.p.quantidade}x · total ${formatarMoeda(detalhe.p.valorTotal)}`}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {detalhe?.parcelas.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 border-b border-border py-1.5">
                <span className="text-muted-foreground">{formatarDataIso(l.vencimento)}</span>
                <span className="font-mono tabular-nums">{formatarMoeda(l.valor)}</span>
                <span className="text-xs text-muted-foreground">{l.situacao}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDetalhe(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function NovoParcelamentoDialog({
  aberto,
  provedores,
  categorias,
  onFechar,
  onCriado,
}: {
  aberto: boolean;
  provedores: Provedor[];
  categorias: CategoriaFinanceiraPublic[];
  onFechar: () => void;
  onCriado: () => void;
}) {
  const { toast } = useToast();
  const [tipo, setTipo] = useState<LancamentoTipo>("despesa");
  const [descricao, setDescricao] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [quantidade, setQuantidade] = useState("3");
  const [primeiroVencimento, setPrimeiroVencimento] = useState(hojeIso());
  const [categoriaId, setCategoriaId] = useState("");
  const [provedorId, setProvedorId] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setTipo("despesa");
    setDescricao("");
    setValorTotal("");
    setQuantidade("3");
    setPrimeiroVencimento(hojeIso());
    setCategoriaId("");
    setProvedorId("");
  }, [aberto]);

  const total = useMemo(() => (valorTotal.trim() ? normalizarValor(valorTotal) : null), [valorTotal]);
  const n = Number(quantidade);
  const nValido = Number.isInteger(n) && n >= 2 && n <= 120;

  /**
   * Prévia das parcelas, com a MESMA função do servidor.
   *
   * É o que torna visível que R$ 100 em 3x não dá três parcelas iguais — dá
   * 33,33 + 33,33 + 33,34, e a soma fecha. Quem cadastra vê o centavo indo
   * para a última em vez de descobrir a diferença na conciliação.
   */
  const previa = useMemo(() => (total && nValido ? dividirEmParcelas(total, n) : []), [total, n, nValido]);

  async function salvar() {
    if (!descricao.trim() || !total || !nValido) return;
    setSalvando(true);
    try {
      await parcelamentoApi.criar({
        tipo,
        descricao: descricao.trim(),
        valorTotal: total,
        quantidade: n,
        primeiroVencimento,
        categoriaId: categoriaId || null,
        provedorId: provedorId || null,
      });
      toast({ titulo: `Parcelamento criado em ${n}x`, variante: "sucesso" });
      onCriado();
    } catch (err) {
      toast({
        titulo: "Não deu para criar",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo parcelamento</DialogTitle>
          <DialogDescription>
            Cada parcela vira um lançamento próprio, com baixa e comprovante separados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="par-tipo">Tipo</Label>
              <Select
                id="par-tipo"
                className="w-full"
                value={tipo}
                onChange={(e) => {
                  setTipo(e.target.value as LancamentoTipo);
                  setCategoriaId("");
                }}
              >
                <option value="despesa">A pagar</option>
                <option value="receita">A receber</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="par-total">Valor total</Label>
              <Input
                id="par-total"
                inputMode="decimal"
                placeholder="0,00"
                value={valorTotal}
                onChange={(e) => setValorTotal(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="par-descricao">Descrição</Label>
            <Input
              id="par-descricao"
              placeholder="Notebook, servidor, licença anual…"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="par-qtd">Parcelas</Label>
              <Input
                id="par-qtd"
                type="number"
                min={2}
                max={120}
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                aria-invalid={!nValido}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="par-venc">1º vencimento</Label>
              <Input
                id="par-venc"
                type="date"
                value={primeiroVencimento}
                onChange={(e) => setPrimeiroVencimento(e.target.value)}
              />
            </div>
          </div>

          {previa.length > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium">
                {descricao.trim()
                  ? descricaoParcela(descricao.trim(), 1, n)
                  : `Parcelas (1/${n})`}{" "}
                em diante
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {previa.slice(0, 4).map((v) => formatarMoeda(v)).join(" · ")}
                {previa.length > 4 && ` … última ${formatarMoeda(previa[previa.length - 1])}`}
              </p>
              {previa[0] !== previa[previa.length - 1] && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Não divide exato: os centavos que sobram vão para a última parcela, então a soma
                  fecha em {formatarMoeda(total!)}.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="par-categoria">Categoria</Label>
              <Select
                id="par-categoria"
                className="w-full"
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
              >
                <option value="">Sem categoria</option>
                {categorias
                  .filter((c) => c.tipo === tipo && c.ativo)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
              </Select>
            </div>
            {tipo === "receita" && (
              <div className="space-y-1.5">
                <Label htmlFor="par-provedor">Provedor</Label>
                <Select
                  id="par-provedor"
                  className="w-full"
                  value={provedorId}
                  onChange={(e) => setProvedorId(e.target.value)}
                >
                  <option value="">Sem provedor</option>
                  {provedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || !descricao.trim() || !total || !nValido}>
            {salvando ? "Criando…" : `Criar em ${nValido ? n : "?"}x`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
