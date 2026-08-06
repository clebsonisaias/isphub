import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FORMA_PAGAMENTO_ROTULO,
  FORMAS_PAGAMENTO,
  formatarCompetencia,
  formatarDataIso,
  formatarMoeda,
  hojeIso,
  normalizarValor,
  type CategoriaFinanceiraPublic,
  type FinanceiroResumo,
  type FormaPagamento,
  type LancamentoPublic,
  type LancamentoSituacao,
  type LancamentoTipo,
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
import { LancamentoDialog } from "@/components/financeiro/LancamentoDialog";
import { LancamentoDetalheDialog } from "@/components/financeiro/LancamentoDetalheDialog";
import { financeiroApi } from "@/lib/financeiroApi";
import { provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { ArrowDownCircle, ArrowUpCircle, Plus, RotateCcw, Search, Wallet } from "lucide-react";

/**
 * FINANCEIRO DA HUBISP — o dinheiro da propria empresa.
 *
 * "A receber" e o que cada provedor paga a hub; "a pagar" e a despesa da hub.
 * Nao tem nada a ver com fatura de assinante do provedor.
 *
 * REGRA DESTA TELA: valor monetario e `string` do primeiro ao ultimo caractere.
 * Nenhum `Number()`, nenhum `reduce` somando dinheiro — os totais do cabecalho
 * vem prontos do servidor (`resumo`), agregados no Postgres. Somar a lista aqui
 * daria o total da PAGINA se passando por total geral, e ainda por cima com
 * aritmetica de float.
 */

const ABAS: { valor: LancamentoTipo; rotulo: string; icone: typeof ArrowUpCircle }[] = [
  { valor: "receita", rotulo: "A receber", icone: ArrowDownCircle },
  { valor: "despesa", rotulo: "A pagar", icone: ArrowUpCircle },
];

const CHIPS: { valor: LancamentoSituacao | "todas"; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todos" },
  { valor: "pendente", rotulo: "Em aberto" },
  { valor: "atrasado", rotulo: "Atrasados" },
  { valor: "pago", rotulo: "Pagos" },
  { valor: "cancelado", rotulo: "Cancelados" },
];

/** Cor por situacao. Segue a regra do projeto: so o PROBLEMA colore forte. */
const CLASSE_SITUACAO: Record<LancamentoSituacao, string> = {
  atrasado: "border-destructive/40 bg-destructive/10 text-destructive",
  pendente: "border-border bg-muted text-muted-foreground",
  pago: "border-success/40 bg-success/10 text-success",
  cancelado: "border-border bg-muted text-muted-foreground line-through",
};

const ROTULO_SITUACAO: Record<LancamentoSituacao, string> = {
  atrasado: "Atrasado",
  pendente: "Em aberto",
  pago: "Pago",
  cancelado: "Cancelado",
};

export function FinanceiroPage() {
  const { toast } = useToast();

  const [tipo, setTipo] = useState<LancamentoTipo>("receita");
  const [situacao, setSituacao] = useState<LancamentoSituacao | "todas">("todas");
  const [provedorId, setProvedorId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");

  const [itens, setItens] = useState<LancamentoPublic[]>([]);
  const [total, setTotal] = useState(0);
  const [resumo, setResumo] = useState<FinanceiroResumo | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [categorias, setCategorias] = useState<CategoriaFinanceiraPublic[]>([]);

  const [novoAberto, setNovoAberto] = useState(false);
  const [editando, setEditando] = useState<LancamentoPublic | null>(null);
  const [detalhe, setDetalhe] = useState<LancamentoPublic | null>(null);
  const [baixando, setBaixando] = useState<LancamentoPublic | null>(null);
  const [carregandoMais, setCarregandoMais] = useState(false);

  /*
   * UM filtro, usado pela primeira pagina e pelo "carregar mais". Duplicado, o
   * "mais" acabaria pedindo um recorte diferente do que esta na tela e
   * emendaria linhas de outro conjunto no fim da lista.
   */
  const filtro = useMemo(
    () => ({
      tipo,
      situacao: situacao === "todas" ? undefined : situacao,
      provedorId: provedorId || undefined,
      categoriaId: categoriaId || undefined,
      de: de || undefined,
      ate: ate || undefined,
      busca: busca.trim() || undefined,
    }),
    [tipo, situacao, provedorId, categoriaId, de, ate, busca],
  );

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await financeiroApi.listar(filtro);
      setItens(r.itens);
      setTotal(r.total);
      setResumo(r.resumo);
    } catch (err) {
      toast({
        titulo: "Não deu para carregar o financeiro",
        descricao: err instanceof ApiError ? err.message : "Tente de novo em instantes.",
        variante: "erro",
      });
    } finally {
      setCarregando(false);
    }
  }, [filtro, toast]);

  /**
   * Proxima pagina, ANEXANDO.
   *
   * O servidor devolve no maximo 200 por vez. Sem isto a lista simplesmente
   * parava ali — a tela chegava a escrever "mostrando 200" de um total maior e
   * nao oferecia caminho nenhum pro resto. O sintoma em producao seria
   * "sumiram lancamentos", que e o pior tipo de bug: parece perda de dado.
   */
  const carregarMais = useCallback(async () => {
    setCarregandoMais(true);
    try {
      const r = await financeiroApi.listar({ ...filtro, offset: itens.length });
      setItens((atuais) => [...atuais, ...r.itens]);
      setTotal(r.total);
    } catch (err) {
      toast({
        titulo: "Não deu para carregar mais",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    } finally {
      setCarregandoMais(false);
    }
  }, [filtro, itens.length, toast]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    void provedoresApi.listar().then(setProvedores).catch(() => setProvedores([]));
    void financeiroApi.categorias().then(setCategorias).catch(() => setCategorias([]));
  }, []);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Wallet className="size-6 text-muted-foreground" aria-hidden />
                Financeiro
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Contas a pagar e a receber da HubISP — o que os provedores pagam à hub e o que a hub gasta.
              </p>
            </div>
            <Button onClick={() => setNovoAberto(true)}>
              <Plus className="size-4" aria-hidden />
              Novo lançamento
            </Button>
          </div>

          <FinanceiroTabs atual="lancamentos" />
        </header>

        <ResumoCabecalho resumo={resumo} carregando={carregando && !resumo} />

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {/* Abas a receber / a pagar */}
              <div role="tablist" aria-label="Tipo de lançamento" className="flex rounded-md border border-border p-0.5">
                {ABAS.map((aba) => (
                  <button
                    key={aba.valor}
                    role="tab"
                    aria-selected={tipo === aba.valor}
                    onClick={() => setTipo(aba.valor)}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:min-h-11",
                      tipo === aba.valor
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <aba.icone className="size-4" aria-hidden />
                    {aba.rotulo}
                  </button>
                ))}
              </div>

              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  aria-label="Buscar lançamento"
                  placeholder="Descrição ou número"
                  className="w-56 pl-8"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>

              <Select
                aria-label="Filtrar por provedor"
                value={provedorId}
                onChange={(e) => setProvedorId(e.target.value)}
              >
                <option value="">Todos os provedores</option>
                {provedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>

              <Select
                aria-label="Filtrar por categoria"
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
              >
                <option value="">Todas as categorias</option>
                {categorias
                  .filter((c) => c.tipo === tipo)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
              </Select>
            </div>

            {/*
              Recorte por VENCIMENTO. A API ja aceitava `de`/`ate` desde a
              primeira fatia; sem o controle na tela nao havia como olhar um
              mes fechado, que e o recorte de todo fechamento.
            */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="fin-de" className="text-xs">
                  Vencimento de
                </Label>
                <Input id="fin-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fin-ate" className="text-xs">
                  até
                </Label>
                <Input id="fin-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
              </div>
              {(de || ate || categoriaId || provedorId || busca) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDe("");
                    setAte("");
                    setCategoriaId("");
                    setProvedorId("");
                    setBusca("");
                  }}
                >
                  Limpar filtros
                </Button>
              )}
            </div>

            {/* Chips de situacao. "Atrasados" e derivado, nao coluna. */}
            <div className="flex flex-wrap gap-1.5">
              {CHIPS.map((chip) => (
                <button
                  key={chip.valor}
                  onClick={() => setSituacao(chip.valor)}
                  aria-pressed={situacao === chip.valor}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-11",
                    situacao === chip.valor
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {chip.rotulo}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Lista
          itens={itens}
          total={total}
          carregando={carregando}
          carregandoMais={carregandoMais}
          onCarregarMais={carregarMais}
          onAbrirDetalhe={setDetalhe}
          onBaixar={setBaixando}
          onEstornar={async (l) => {
            try {
              await financeiroApi.estornar(l.id);
              toast({ titulo: `Baixa do lançamento ${l.numero} estornada`, variante: "sucesso" });
              await carregar();
            } catch (err) {
              toast({
                titulo: "Não deu para estornar",
                descricao: err instanceof ApiError ? err.message : undefined,
                variante: "erro",
              });
            }
          }}
        />
      </div>

      <LancamentoDialog
        aberto={novoAberto || !!editando}
        lancamento={editando}
        tipoInicial={tipo}
        provedores={provedores}
        categorias={categorias}
        onFechar={() => {
          setNovoAberto(false);
          setEditando(null);
        }}
        onSalvo={async () => {
          setNovoAberto(false);
          setEditando(null);
          await carregar();
        }}
      />

      <LancamentoDetalheDialog
        lancamento={detalhe}
        onFechar={() => setDetalhe(null)}
        // So a LISTA. O detalhe se recarrega sozinho (ver recarregarEste) —
        // o pai mexendo no estado dele reabria o dialogo recem-fechado.
        onMudou={() => void carregar()}
        onEditar={(l) => {
          setDetalhe(null);
          setEditando(l);
        }}
      />

      <DialogBaixa
        lancamento={baixando}
        onFechar={() => setBaixando(null)}
        onBaixado={async () => {
          setBaixando(null);
          await carregar();
        }}
      />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Cabecalho de totais
// ---------------------------------------------------------------------------

/**
 * Os numeros vem PRONTOS do servidor. Nenhuma soma acontece aqui — e o que
 * garante que o total seja o total, e nao a soma do que coube na pagina.
 */
function ResumoCabecalho({ resumo, carregando }: { resumo: FinanceiroResumo | null; carregando: boolean }) {
  if (carregando || !resumo) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  const temVencido = resumo.quantidadeVencidos > 0;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <CardTotal rotulo="A receber em aberto" valor={resumo.aReceberEmAberto} />
      <CardTotal rotulo="A pagar em aberto" valor={resumo.aPagarEmAberto} />
      <Card className={cn(temVencido && "border-destructive/40 bg-destructive/5")}>
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vencidos</p>
          <p
            className={cn(
              "mt-1 font-mono text-2xl font-semibold tabular-nums",
              temVencido ? "text-destructive" : "text-foreground",
            )}
          >
            {formatarMoeda(resumo.vencidoAReceber)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {resumo.quantidadeVencidos === 0
              ? "Nada vencido"
              : `${resumo.quantidadeVencidos} lançamento${resumo.quantidadeVencidos > 1 ? "s" : ""} · ${formatarMoeda(resumo.vencidoAPagar)} a pagar`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CardTotal({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        {/* tabular-nums: colunas de dinheiro que nao dancam ao atualizar. */}
        <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{formatarMoeda(valor)}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

function Lista({
  itens,
  total,
  carregando,
  carregandoMais,
  onCarregarMais,
  onAbrirDetalhe,
  onBaixar,
  onEstornar,
}: {
  itens: LancamentoPublic[];
  total: number;
  carregando: boolean;
  carregandoMais: boolean;
  onCarregarMais: () => void;
  onAbrirDetalhe: (l: LancamentoPublic) => void;
  onBaixar: (l: LancamentoPublic) => void;
  onEstornar: (l: LancamentoPublic) => void;
}) {
  if (carregando) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  if (itens.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Nenhum lançamento neste recorte.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {total} lançamento{total > 1 ? "s" : ""}
        {itens.length < total && ` · mostrando ${itens.length}`}
      </p>

      {/*
        `ul`/`li` de verdade, nao uma pilha de divs: isto e uma lista, e o
        leitor de tela anuncia "lista, N itens" e permite pular de item em item.
        De quebra, cada linha vira um `listitem` enderecavel — o que da uma
        ancora estavel pra qualquer coisa que precise falar de UMA linha.
      */}
      <ul className="space-y-2" aria-label="Lançamentos">
        {itens.map((l) => (
        <li key={l.id}>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
            <span className="font-mono text-xs text-muted-foreground tabular-nums">#{l.numero}</span>

            {/*
              A descricao e um BOTAO, nao o card inteiro. Card clicavel com
              botoes dentro aninha elemento interativo em elemento interativo —
              o leitor de tela anuncia errado e o teclado tabula pra lugar
              nenhum.
            */}
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onAbrirDetalhe(l)}
                className="max-w-full truncate text-left font-medium underline-offset-2 hover:underline"
              >
                {l.descricao}
              </button>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>Vence {formatarDataIso(l.vencimento)}</span>
                <span aria-hidden>·</span>
                <span title="Mês de referência — separado do vencimento">
                  Comp. {formatarCompetencia(l.competencia)}
                </span>
                {l.provedorNome && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: l.provedorCor ?? "#6366f1" }}
                        aria-hidden
                      />
                      {l.provedorNome}
                    </span>
                  </>
                )}
                {l.categoriaNome && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{l.categoriaNome}</span>
                  </>
                )}
              </p>
            </div>

            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-medium",
                CLASSE_SITUACAO[l.situacao],
              )}
            >
              {ROTULO_SITUACAO[l.situacao]}
            </span>

            <span className="font-mono text-base font-semibold tabular-nums">{formatarMoeda(l.valor)}</span>

            {l.status === "pendente" && (
              <Button size="sm" onClick={() => onBaixar(l)}>
                Dar baixa
              </Button>
            )}
            {l.status === "pago" && (
              <Button size="sm" variant="ghost" onClick={() => onEstornar(l)} title="Desfazer a baixa">
                <RotateCcw className="size-4" aria-hidden />
                Estornar
              </Button>
            )}
          </CardContent>
        </Card>
        </li>
        ))}
      </ul>

      {itens.length < total && (
        <div className="pt-2 text-center">
          <Button variant="secondary" onClick={onCarregarMais} disabled={carregandoMais}>
            {carregandoMais ? "Carregando…" : `Carregar mais (${total - itens.length} restantes)`}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Baixa
// ---------------------------------------------------------------------------

function DialogBaixa({
  lancamento,
  onFechar,
  onBaixado,
}: {
  lancamento: LancamentoPublic | null;
  onFechar: () => void;
  onBaixado: () => void;
}) {
  const { toast } = useToast();
  const [pagoEm, setPagoEm] = useState(hojeIso());
  const [valorPago, setValorPago] = useState("");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>("pix");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (lancamento) {
      setPagoEm(hojeIso());
      // Pre-preenchido com o valor cheio: pagamento com juros ou desconto e a
      // excecao, entao o caminho comum e so confirmar.
      setValorPago(lancamento.valor);
      setFormaPagamento("pix");
    }
  }, [lancamento]);

  const valorNormalizado = useMemo(() => (valorPago.trim() ? normalizarValor(valorPago) : null), [valorPago]);
  const valorInvalido = valorPago.trim().length > 0 && valorNormalizado === null;
  const divergente = !!lancamento && !!valorNormalizado && valorNormalizado !== lancamento.valor;

  async function confirmar() {
    if (!lancamento || !valorNormalizado) return;
    setSalvando(true);
    try {
      await financeiroApi.baixar(lancamento.id, { pagoEm, valorPago: valorNormalizado, formaPagamento });
      toast({ titulo: `Lançamento ${lancamento.numero} baixado`, variante: "sucesso" });
      onBaixado();
    } catch (err) {
      toast({
        titulo: "Não deu para dar baixa",
        // A mensagem da API importa aqui: 409 significa que outra pessoa deu
        // baixa primeiro, e quem esta na tela precisa saber disso — nao de um
        // "erro ao salvar" generico.
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!lancamento} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dar baixa</DialogTitle>
          <DialogDescription>
            {lancamento && (
              <>
                #{lancamento.numero} · {lancamento.descricao} · {formatarMoeda(lancamento.valor)}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="baixa-data">Data do pagamento</Label>
              <Input id="baixa-data" type="date" value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baixa-valor">Valor pago</Label>
              <Input
                id="baixa-valor"
                inputMode="decimal"
                value={valorPago}
                onChange={(e) => setValorPago(e.target.value)}
                aria-invalid={valorInvalido}
              />
              {valorInvalido && (
                <p role="alert" className="text-xs text-destructive">
                  Valor inválido.
                </p>
              )}
              {divergente && !valorInvalido && (
                <p className="text-xs text-muted-foreground">
                  Diferente do previsto ({formatarMoeda(lancamento!.valor)}) — juros ou desconto.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="baixa-forma">Forma de pagamento</Label>
            <Select
              id="baixa-forma"
              className="w-full"
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value as FormaPagamento)}
            >
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f} value={f}>
                  {FORMA_PAGAMENTO_ROTULO[f]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvando || !valorNormalizado}>
            {salvando ? "Confirmando…" : "Confirmar baixa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
