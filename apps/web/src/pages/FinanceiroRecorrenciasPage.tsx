import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FREQUENCIA_ROTULO,
  FREQUENCIAS,
  formatarDataIso,
  formatarMoeda,
  hojeIso,
  normalizarValor,
  ocorrenciasEntre,
  type CategoriaFinanceiraPublic,
  type FrequenciaRecorrencia,
  type LancamentoTipo,
  type Provedor,
  type RecorrenciaPublic,
} from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { Plus, Power, RefreshCw } from "lucide-react";

/**
 * RECORRÊNCIAS — a regra que gera lançamentos repetidos.
 *
 * A mensalidade que cada provedor paga à hub e as contas fixas dela. Cada
 * ocorrência vira um lançamento de verdade na aba Lançamentos, com baixa,
 * comprovante e histórico próprios.
 */
export function FinanceiroRecorrenciasPage() {
  const { toast } = useToast();
  const [itens, setItens] = useState<RecorrenciaPublic[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [categorias, setCategorias] = useState<CategoriaFinanceiraPublic[]>([]);
  const [editando, setEditando] = useState<RecorrenciaPublic | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setItens(await recorrenciaApi.listar());
    } catch (err) {
      toast({
        titulo: "Não deu para carregar as recorrências",
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

  async function gerar(r: RecorrenciaPublic) {
    try {
      const { criados, existentes } = await recorrenciaApi.gerar(r.id);
      // A mensagem diz o que ACONTECEU. Anunciar "geradas" quando nada foi
      // gerado é o que mascarava a duplicação no ERP de origem.
      toast({
        titulo:
          criados > 0
            ? `${criados} lançamento${criados > 1 ? "s" : ""} gerado${criados > 1 ? "s" : ""}`
            : "Nada a gerar — já estava tudo em dia",
        descricao: existentes > 0 ? `${existentes} já existia${existentes > 1 ? "m" : ""}.` : undefined,
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

  async function alternar(r: RecorrenciaPublic) {
    try {
      await recorrenciaApi.editar(r.id, { ativa: !r.ativa });
      await carregar();
    } catch (err) {
      toast({
        titulo: "Não deu para salvar",
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
                Recorrências — o que se repete todo mês vira lançamento sozinho.
              </p>
            </div>
            <Button onClick={() => setNovoAberto(true)}>
              <Plus className="size-4" aria-hidden />
              Nova recorrência
            </Button>
          </div>
          <FinanceiroTabs atual="recorrencias" />
        </header>

        {carregando ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : itens.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma recorrência ainda. Crie uma para a mensalidade de cada provedor e ela passa a
                gerar o lançamento do mês sozinha.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2" aria-label="Recorrências">
            {itens.map((r) => (
              <li key={r.id}>
                <Card className={cn(!r.ativa && "opacity-60")}>
                  <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-medium",
                        r.tipo === "receita"
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {r.tipo === "receita" ? "A receber" : "A pagar"}
                    </span>

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
                        {r.fim && (
                          <>
                            <span aria-hidden>·</span>
                            <span>até {formatarDataIso(r.fim)}</span>
                          </>
                        )}
                        {r.provedorNome && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="inline-flex items-center gap-1">
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: r.provedorCor ?? "#6366f1" }}
                                aria-hidden
                              />
                              {r.provedorNome}
                            </span>
                          </>
                        )}
                        <span aria-hidden>·</span>
                        <span>{r.ocorrenciasGeradas} lançamento(s) gerado(s)</span>
                      </p>
                    </div>

                    <span className="font-mono text-base font-semibold tabular-nums">
                      {formatarMoeda(r.valor)}
                    </span>

                    <Button size="sm" variant="secondary" onClick={() => gerar(r)} title="Gerar os que faltam">
                      <RefreshCw className="size-4" aria-hidden />
                      Gerar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => alternar(r)}
                      title={r.ativa ? "Pausar (para de gerar novos)" : "Reativar"}
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

      <RecorrenciaDialog
        aberto={novoAberto || !!editando}
        recorrencia={editando}
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
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

function RecorrenciaDialog({
  aberto,
  recorrencia,
  provedores,
  categorias,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  recorrencia: RecorrenciaPublic | null;
  provedores: Provedor[];
  categorias: CategoriaFinanceiraPublic[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const editando = !!recorrencia;

  const [tipo, setTipo] = useState<LancamentoTipo>("receita");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [frequencia, setFrequencia] = useState<FrequenciaRecorrencia>("mensal");
  const [diaVencimento, setDiaVencimento] = useState("10");
  const [inicio, setInicio] = useState(hojeIso());
  const [fim, setFim] = useState("");
  const [provedorId, setProvedorId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    if (recorrencia) {
      setTipo(recorrencia.tipo);
      setDescricao(recorrencia.descricao);
      setValor(recorrencia.valor);
      setFrequencia(recorrencia.frequencia);
      setDiaVencimento(String(recorrencia.diaVencimento));
      setInicio(recorrencia.inicio);
      setFim(recorrencia.fim ?? "");
      setProvedorId(recorrencia.provedorId ?? "");
      setCategoriaId(recorrencia.categoriaId ?? "");
      setObservacao(recorrencia.observacao ?? "");
    } else {
      setTipo("receita");
      setDescricao("");
      setValor("");
      setFrequencia("mensal");
      setDiaVencimento("10");
      setInicio(hojeIso());
      setFim("");
      setProvedorId("");
      setCategoriaId("");
      setObservacao("");
    }
  }, [aberto, recorrencia]);

  const valorNormalizado = useMemo(() => (valor.trim() ? normalizarValor(valor) : null), [valor]);
  const dia = Number(diaVencimento);
  const diaValido = Number.isInteger(dia) && dia >= 1 && dia <= 31;

  /**
   * Prévia das próximas datas, calculada com a MESMA função do servidor.
   *
   * É o que torna visível que o dia 31 vira 28 em fevereiro e VOLTA a 31 em
   * março — quem cadastra vê a regra funcionando em vez de descobrir meses
   * depois que a série deslizou.
   */
  const previa = useMemo(() => {
    if (!diaValido || !inicio) return [];
    return ocorrenciasEntre({
      inicio,
      fim: fim || null,
      frequencia,
      diaVencimento: dia,
      ate: `${Number(inicio.slice(0, 4)) + 1}-12-31`,
    }).slice(0, 6);
  }, [inicio, fim, frequencia, dia, diaValido]);

  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo && c.ativo);

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
        fim: fim || null,
        provedorId: provedorId || null,
        categoriaId: categoriaId || null,
        observacao: observacao.trim() || null,
      };
      const r = recorrencia
        ? await recorrenciaApi.editar(recorrencia.id, dados)
        : await recorrenciaApi.criar({ ...dados, tipo });
      toast({
        titulo: editando ? "Recorrência atualizada" : "Recorrência criada",
        descricao:
          r.geracao.criados > 0
            ? `${r.geracao.criados} lançamento(s) gerado(s).`
            : "Nenhum lançamento novo a gerar.",
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
          <DialogTitle>{editando ? "Editar recorrência" : "Nova recorrência"}</DialogTitle>
          <DialogDescription>
            {editando
              ? "A mudança vale das próximas ocorrências em diante — o que já foi gerado não é reescrito."
              : "Uma regra que gera lançamentos repetidos, como a mensalidade de um provedor."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-tipo">Tipo</Label>
              <Select
                id="rec-tipo"
                className="w-full"
                value={tipo}
                disabled={editando}
                onChange={(e) => {
                  setTipo(e.target.value as LancamentoTipo);
                  setCategoriaId("");
                }}
              >
                <option value="receita">A receber</option>
                <option value="despesa">A pagar</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-valor">Valor</Label>
              <Input
                id="rec-valor"
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-descricao">Descrição</Label>
            <Input
              id="rec-descricao"
              placeholder={tipo === "receita" ? "Mensalidade do provedor X" : "Aluguel do escritório"}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-freq">Frequência</Label>
              <Select
                id="rec-freq"
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
              <Label htmlFor="rec-dia">Dia</Label>
              <Input
                id="rec-dia"
                type="number"
                min={1}
                max={31}
                value={diaVencimento}
                onChange={(e) => setDiaVencimento(e.target.value)}
                aria-invalid={!diaValido}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-inicio">Início</Label>
              <Input id="rec-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-fim">Fim (opcional)</Label>
            <Input id="rec-fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            <p className="text-xs text-muted-foreground">Em branco = indefinida, gera para sempre.</p>
          </div>

          {previa.length > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium">Próximos vencimentos</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {previa.map((d) => formatarDataIso(d)).join(" · ")}
                {previa.length === 6 && " …"}
              </p>
              {dia > 28 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Em meses mais curtos o vencimento cai no último dia — e volta ao dia {dia} no mês seguinte.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-categoria">Categoria</Label>
              <Select
                id="rec-categoria"
                className="w-full"
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
              >
                <option value="">Sem categoria</option>
                {categoriasDoTipo.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </div>
            {tipo === "receita" && (
              <div className="space-y-1.5">
                <Label htmlFor="rec-provedor">Provedor</Label>
                <Select
                  id="rec-provedor"
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

          <div className="space-y-1.5">
            <Label htmlFor="rec-obs">Observação</Label>
            <Textarea
              id="rec-obs"
              rows={2}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || !descricao.trim() || !valorNormalizado || !diaValido}>
            {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Criar recorrência"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
