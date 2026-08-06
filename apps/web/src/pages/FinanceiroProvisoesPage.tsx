import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FREQUENCIA_ROTULO,
  FREQUENCIAS,
  TIPO_PROVISAO_ROTULO,
  TIPOS_PROVISAO,
  formatarDataIso,
  formatarMoeda,
  hojeIso,
  normalizarValor,
  tipoProvisaoOuPadrao,
  type CategoriaFinanceiraPublic,
  type FrequenciaRecorrencia,
  type RecorrenciaPublic,
  type TipoProvisao,
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
import { financeiroApi, recorrenciaApi } from "@/lib/financeiroApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { Plus, Power, RefreshCw, Search } from "lucide-react";

/**
 * PROVISÕES — dinheiro reservado para uma despesa esperada.
 *
 * Uma provisão é uma RECORRÊNCIA com tipo, não outra máquina. O ERP de origem
 * mantém um gerador separado só para provisão, e é exatamente por isso que um
 * dos dois duplicava e o outro não — dois caminhos para o mesmo problema
 * divergem sozinhos.
 */
export function FinanceiroProvisoesPage() {
  const { toast } = useToast();
  const [todas, setTodas] = useState<RecorrenciaPublic[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<TipoProvisao>("previsivel");
  const [busca, setBusca] = useState("");
  const [categorias, setCategorias] = useState<CategoriaFinanceiraPublic[]>([]);
  const [novoAberto, setNovoAberto] = useState(false);
  const [editando, setEditando] = useState<RecorrenciaPublic | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      // UMA consulta com todas as provisões. É o que permite os contadores por
      // tipo sem quatro chamadas — o agrupamento é em memória, como na origem.
      setTodas(await recorrenciaApi.listar({ provisoes: true }));
    } catch (err) {
      toast({
        titulo: "Não deu para carregar as provisões",
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
    void financeiroApi.categorias().then(setCategorias).catch(() => setCategorias([]));
  }, []);

  /** Agrupa em memória. `tipoProvisaoOuPadrao` garante que nada suma da tela. */
  const porTipo = useMemo(() => {
    const mapa = Object.fromEntries(TIPOS_PROVISAO.map((t) => [t, [] as RecorrenciaPublic[]])) as Record<
      TipoProvisao,
      RecorrenciaPublic[]
    >;
    for (const r of todas) mapa[tipoProvisaoOuPadrao(r.tipoProvisao)].push(r);
    return mapa;
  }, [todas]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = porTipo[aba];
    return termo ? lista.filter((r) => r.descricao.toLowerCase().includes(termo)) : lista;
  }, [porTipo, aba, busca]);

  async function gerar(r: RecorrenciaPublic) {
    try {
      const { criados, existentes } = await recorrenciaApi.gerar(r.id);
      toast({
        titulo: criados > 0 ? `${criados} lançamento(s) gerado(s)` : "Nada a gerar — já estava tudo em dia",
        descricao: existentes > 0 ? `${existentes} já existia(m).` : undefined,
        variante: "sucesso",
      });
      await carregar();
    } catch (err) {
      toast({
        titulo: "Não deu para gerar",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
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
                Provisões — dinheiro reservado para uma despesa esperada.
              </p>
            </div>
            <Button onClick={() => setNovoAberto(true)}>
              <Plus className="size-4" aria-hidden />
              Nova provisão
            </Button>
          </div>
          <FinanceiroTabs atual="provisoes" />
        </header>

        {/* Uma aba por tipo, com o contador de cada uma. */}
        <div role="tablist" aria-label="Tipo de provisão" className="flex flex-wrap gap-1.5">
          {TIPOS_PROVISAO.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={aba === t}
              onClick={() => {
                setAba(t);
                // A busca é da aba corrente; carregá-la para a próxima faria a
                // lista abrir vazia sem explicação.
                setBusca("");
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:min-h-11",
                aba === t
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {TIPO_PROVISAO_ROTULO[t]}
              <span className="ml-1.5 opacity-70">{porTipo[t].length}</span>
            </button>
          ))}

          <div className="relative ml-auto">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Buscar provisão"
              placeholder="Buscar nesta aba"
              className="w-56 pl-8"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>

        {carregando ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : visiveis.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <p className="text-sm text-muted-foreground">
                {busca
                  ? "Nada encontrado nesta aba."
                  : `Nenhuma provisão de ${TIPO_PROVISAO_ROTULO[aba].toLowerCase()} ainda.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2" aria-label="Provisões">
            {visiveis.map((r) => (
              <li key={r.id}>
                <Card className={cn(!r.ativa && "opacity-60")}>
                  <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setEditando(r)}
                        className="max-w-full truncate text-left font-medium underline-offset-2 hover:underline"
                      >
                        {r.descricao}
                      </button>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{FREQUENCIA_ROTULO[r.frequencia]}</span>
                        <span aria-hidden>·</span>
                        <span>dia {r.diaVencimento}</span>
                        <span aria-hidden>·</span>
                        <span>desde {formatarDataIso(r.inicio)}</span>
                        <span aria-hidden>·</span>
                        <span>{r.ocorrenciasGeradas} lançamento(s)</span>
                      </p>
                    </div>
                    <span className="font-mono text-base font-semibold tabular-nums">
                      {formatarMoeda(r.valor)}
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => gerar(r)}>
                      <RefreshCw className="size-4" aria-hidden />
                      Gerar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await recorrenciaApi.editar(r.id, { ativa: !r.ativa });
                        await carregar();
                      }}
                    >
                      <Power className="size-4" aria-hidden />
                      {r.ativa ? "Pausar" : "Reativar"}
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProvisaoDialog
        aberto={novoAberto || !!editando}
        provisao={editando}
        tipoInicial={aba}
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
    </AppShell>
  );
}

function ProvisaoDialog({
  aberto,
  provisao,
  tipoInicial,
  categorias,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  provisao: RecorrenciaPublic | null;
  tipoInicial: TipoProvisao;
  categorias: CategoriaFinanceiraPublic[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const editando = !!provisao;

  const [tipoProvisao, setTipoProvisao] = useState<TipoProvisao>(tipoInicial);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [frequencia, setFrequencia] = useState<FrequenciaRecorrencia>("mensal");
  const [diaVencimento, setDiaVencimento] = useState("10");
  const [inicio, setInicio] = useState(hojeIso());
  const [categoriaId, setCategoriaId] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    if (provisao) {
      setTipoProvisao(tipoProvisaoOuPadrao(provisao.tipoProvisao));
      setDescricao(provisao.descricao);
      setValor(provisao.valor);
      setFrequencia(provisao.frequencia);
      setDiaVencimento(String(provisao.diaVencimento));
      setInicio(provisao.inicio);
      setCategoriaId(provisao.categoriaId ?? "");
    } else {
      // Nasce no tipo da aba corrente — quem está em "Tributos" quer criar uma
      // de tributos.
      setTipoProvisao(tipoInicial);
      setDescricao("");
      setValor("");
      setFrequencia("mensal");
      setDiaVencimento("10");
      setInicio(hojeIso());
      setCategoriaId("");
    }
  }, [aberto, provisao, tipoInicial]);

  const valorNormalizado = useMemo(() => (valor.trim() ? normalizarValor(valor) : null), [valor]);
  const dia = Number(diaVencimento);
  const diaValido = Number.isInteger(dia) && dia >= 1 && dia <= 31;

  async function salvar() {
    if (!descricao.trim() || !valorNormalizado || !diaValido) return;
    setSalvando(true);
    try {
      const dados = {
        descricao: descricao.trim(),
        valor: valorNormalizado,
        frequencia,
        diaVencimento: dia,
        inicio,
        tipoProvisao,
        categoriaId: categoriaId || null,
      };
      const r = provisao
        ? await recorrenciaApi.editar(provisao.id, dados)
        : await recorrenciaApi.criar({ ...dados, tipo: "despesa" });
      toast({
        titulo: editando ? "Provisão atualizada" : "Provisão criada",
        descricao: r.geracao.criados > 0 ? `${r.geracao.criados} lançamento(s) gerado(s).` : undefined,
        variante: "sucesso",
      });
      onSalvo();
    } catch (err) {
      toast({
        titulo: "Não deu para salvar",
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
          <DialogTitle>{editando ? "Editar provisão" : "Nova provisão"}</DialogTitle>
          <DialogDescription>
            Dinheiro reservado para uma despesa esperada. Gera lançamentos como uma recorrência.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="prov-tipo">Tipo de provisão</Label>
              <Select
                id="prov-tipo"
                className="w-full"
                value={tipoProvisao}
                onChange={(e) => setTipoProvisao(e.target.value as TipoProvisao)}
              >
                {TIPOS_PROVISAO.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_PROVISAO_ROTULO[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prov-valor">Valor</Label>
              <Input
                id="prov-valor"
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prov-descricao">Descrição</Label>
            <Input
              id="prov-descricao"
              placeholder="13º salário, IRPJ, férias…"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="prov-freq">Frequência</Label>
              <Select
                id="prov-freq"
                className="w-full"
                value={frequencia}
                onChange={(e) => setFrequencia(e.target.value as FrequenciaRecorrencia)}
              >
                {FREQUENCIAS.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCIA_ROTULO[f]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prov-dia">Dia</Label>
              <Input
                id="prov-dia"
                type="number"
                min={1}
                max={31}
                value={diaVencimento}
                onChange={(e) => setDiaVencimento(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prov-inicio">Início</Label>
              <Input id="prov-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prov-categoria">Categoria</Label>
            <Select
              id="prov-categoria"
              className="w-full"
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
            >
              <option value="">Sem categoria</option>
              {categorias
                .filter((c) => c.tipo === "despesa" && c.ativo)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || !descricao.trim() || !valorNormalizado || !diaValido}>
            {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Criar provisão"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
