import { useEffect, useMemo, useState } from "react";
import {
  competenciaDe,
  formatarCompetencia,
  hojeIso,
  normalizarValor,
  type CategoriaFinanceiraPublic,
  type LancamentoPublic,
  type LancamentoTipo,
  type Provedor,
} from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { financeiroApi } from "@/lib/financeiroApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";

/**
 * Criar E editar lancamento — o MESMO dialogo, dois modos.
 *
 * Separados, os dois formularios divergiriam: um ganharia um campo, o outro
 * nao, e a validacao passaria a aceitar coisas diferentes conforme a porta de
 * entrada. Como os campos sao identicos, a unica diferenca honesta e o verbo.
 *
 * So lancamento PENDENTE e editavel — a API recusa o resto com 409. Mexer no
 * valor de algo ja pago e reescrever a historia; para isso existe o estorno,
 * que deixa rastro.
 */
export function LancamentoDialog({
  aberto,
  /** Presente = modo edicao. Ausente = criacao. */
  lancamento,
  tipoInicial,
  provedores,
  categorias,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  lancamento?: LancamentoPublic | null;
  tipoInicial: LancamentoTipo;
  provedores: Provedor[];
  categorias: CategoriaFinanceiraPublic[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const editando = !!lancamento;

  const [tipo, setTipo] = useState<LancamentoTipo>(tipoInicial);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(hojeIso());
  const [provedorId, setProvedorId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Repovoa a cada abertura: reaproveitar o estado do formulario anterior faria
  // a edicao de um lancamento herdar o valor digitado no anterior.
  useEffect(() => {
    if (!aberto) return;
    if (lancamento) {
      setTipo(lancamento.tipo);
      setDescricao(lancamento.descricao);
      setValor(lancamento.valor);
      setVencimento(lancamento.vencimento);
      setProvedorId(lancamento.provedorId ?? "");
      setCategoriaId(lancamento.categoriaId ?? "");
      setObservacao(lancamento.observacao ?? "");
    } else {
      setTipo(tipoInicial);
      setDescricao("");
      setValor("");
      setVencimento(hojeIso());
      setProvedorId("");
      setCategoriaId("");
      setObservacao("");
    }
  }, [aberto, lancamento, tipoInicial]);

  // Valida com a MESMA funcao que a API usa (packages/shared), pra que
  // "1.234,56" nao seja aceito aqui e recusado la — ou o contrario.
  const valorNormalizado = useMemo(() => (valor.trim() ? normalizarValor(valor) : null), [valor]);
  const valorInvalido = valor.trim().length > 0 && valorNormalizado === null;
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo && c.ativo);

  async function salvar() {
    if (!descricao.trim() || !valorNormalizado) return;
    setSalvando(true);
    try {
      const dados = {
        descricao: descricao.trim(),
        valor: valorNormalizado,
        vencimento,
        provedorId: provedorId || null,
        categoriaId: categoriaId || null,
        observacao: observacao.trim() || null,
      };
      if (lancamento) {
        // `tipo` fica de fora na edicao: virar receita em despesa mudaria o
        // sinal de tudo que ja foi contado em relatorio. Quem errou o tipo
        // cancela e lanca de novo — e o cancelamento deixa rastro.
        await financeiroApi.editar(lancamento.id, dados);
      } else {
        await financeiroApi.criar({ ...dados, tipo });
      }
      toast({ titulo: editando ? "Lançamento atualizado" : "Lançamento criado", variante: "sucesso" });
      onSalvo();
    } catch (err) {
      toast({
        titulo: editando ? "Não deu para salvar" : "Não deu para criar o lançamento",
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
          <DialogTitle>
            {editando ? `Editar lançamento #${lancamento!.numero}` : "Novo lançamento"}
          </DialogTitle>
          <DialogDescription>
            {editando
              ? "Só lançamentos em aberto podem ser editados."
              : "Conta da HubISP — a receber de um provedor, ou a pagar pela própria hub."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fin-tipo">Tipo</Label>
              <Select
                id="fin-tipo"
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
              {editando && (
                <p className="text-xs text-muted-foreground">
                  Para trocar o tipo, cancele e lance de novo.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fin-valor">Valor</Label>
              <Input
                id="fin-valor"
                // `inputMode="decimal"` abre o teclado numerico no celular sem
                // recusar a virgula — `type="number"` recusaria, e no Brasil o
                // decimal se digita com virgula.
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                aria-invalid={valorInvalido}
                aria-describedby={valorInvalido ? "fin-valor-erro" : undefined}
              />
              {valorInvalido && (
                <p id="fin-valor-erro" role="alert" className="text-xs text-destructive">
                  Informe um valor maior que zero (ex.: 1.234,56).
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fin-descricao">Descrição</Label>
            <Input
              id="fin-descricao"
              placeholder={tipo === "receita" ? "Mensalidade do provedor X" : "Aluguel do escritório"}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fin-vencimento">Vencimento</Label>
              <Input
                id="fin-vencimento"
                type="date"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Competência: {formatarCompetencia(competenciaDe(vencimento))}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fin-categoria">Categoria</Label>
              <Select
                id="fin-categoria"
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
          </div>

          {/* Provedor so faz sentido no que a hub RECEBE: e a contraparte. */}
          {tipo === "receita" && (
            <div className="space-y-1.5">
              <Label htmlFor="fin-provedor">Provedor (quem paga)</Label>
              <Select
                id="fin-provedor"
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

          <div className="space-y-1.5">
            <Label htmlFor="fin-obs">Observação</Label>
            <Textarea
              id="fin-obs"
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
          <Button onClick={salvar} disabled={salvando || !descricao.trim() || !valorNormalizado}>
            {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Criar lançamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
