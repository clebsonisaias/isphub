import { useEffect, useState } from "react";
import {
  CLASSIFICACAO_DRE_ROTULO,
  CLASSIFICACOES_DRE,
  type CategoriaFinanceiraPublic,
  type ClassificacaoDre,
} from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { financeiroApi } from "@/lib/financeiroApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, Plus } from "lucide-react";

/**
 * Categorias do financeiro e a classificacao de cada uma no DRE.
 *
 * Vive na tela de RELATORIOS, colada no aviso de "sem classificação", e nao
 * numa tela de administracao separada. A razao e de fluxo: quem descobre que o
 * demonstrativo tem um buraco e quem esta olhando o demonstrativo, e mandar
 * essa pessoa procurar outro menu pra resolver e onde a tarefa morre.
 *
 * A classificacao so aparece em categoria de DESPESA — receita nao se
 * classifica, ela e a primeira linha do DRE.
 */
export function CategoriasCard({
  categorias,
  onMudou,
}: {
  categorias: CategoriaFinanceiraPublic[];
  onMudou: () => void;
}) {
  const { toast } = useToast();
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"receita" | "despesa">("despesa");
  const [salvando, setSalvando] = useState(false);

  const semClassificacao = categorias.filter((c) => c.tipo === "despesa" && !c.classificacao).length;

  async function criar() {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      await financeiroApi.criarCategoria({ nome: nome.trim(), tipo });
      setNome("");
      toast({ titulo: "Categoria criada", variante: "sucesso" });
      onMudou();
    } catch (err) {
      toast({
        titulo: "Não deu para criar a categoria",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    } finally {
      setSalvando(false);
    }
  }

  /** Renomear, trocar cor ou (des)ativar. Sem isto, categoria criada errada nao tinha conserto. */
  async function salvarCampo(id: string, dados: { nome?: string; cor?: string; ativo?: boolean }) {
    try {
      await financeiroApi.editarCategoria(id, dados);
      onMudou();
    } catch (err) {
      toast({
        titulo: "Não deu para salvar a categoria",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
      // Recarrega pra desfazer na tela o que o servidor recusou — senao a UI
      // ficaria mostrando um nome que nao foi gravado.
      onMudou();
    }
  }

  async function classificar(id: string, valor: string) {
    try {
      // String vazia no `<select>` significa LIMPAR — e `null` explícito, não
      // `undefined`: omitir o campo mandaria a API manter o que já estava.
      await financeiroApi.editarCategoria(id, {
        classificacao: valor === "" ? null : (valor as ClassificacaoDre),
      });
      onMudou();
    } catch (err) {
      toast({
        titulo: "Não deu para classificar",
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    }
  }

  const despesas = categorias.filter((c) => c.tipo === "despesa");
  const receitas = categorias.filter((c) => c.tipo === "receita");

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Categorias</CardTitle>
        <CardDescription>
          A classificação define em qual linha do DRE a despesa entra.
          {semClassificacao > 0 &&
            ` ${semClassificacao} categoria${semClassificacao > 1 ? "s" : ""} de despesa ainda sem classificação.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label htmlFor="cat-nome">Nova categoria</Label>
            <Input
              id="cat-nome"
              placeholder={tipo === "despesa" ? "Aluguel, VPS, Contabilidade…" : "Mensalidade de provedor"}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void criar()}
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-tipo">Tipo</Label>
            <Select id="cat-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "receita" | "despesa")}>
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
            </Select>
          </div>
          <Button onClick={criar} disabled={salvando || !nome.trim()}>
            <Plus className="size-4" aria-hidden />
            Criar
          </Button>
        </div>

        {despesas.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Despesas</h3>
            <ul className="flex flex-col gap-2">
              {despesas.map((c) => (
                <LinhaCategoria key={c.id} categoria={c} onSalvar={salvarCampo} onClassificar={classificar} />
              ))}
            </ul>
          </div>
        )}

        {receitas.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Receitas</h3>
            <ul className="flex flex-col gap-2">
              {receitas.map((c) => (
                <LinhaCategoria key={c.id} categoria={c} onSalvar={salvarCampo} onClassificar={classificar} />
              ))}
            </ul>
          </div>
        )}

        {categorias.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma categoria ainda. Sem elas o DRE não tem como dizer de onde vem o gasto.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Uma categoria: nome editavel no lugar, cor, classificacao e ativo/inativo.
 *
 * O nome so vai pro servidor no `blur` ou no Enter — salvar a cada tecla
 * dispararia um PATCH por caractere, e o nome e `@unique`: metade das
 * requisicoes voltaria 409 enquanto a pessoa ainda esta digitando.
 */
function LinhaCategoria({
  categoria,
  onSalvar,
  onClassificar,
}: {
  categoria: CategoriaFinanceiraPublic;
  onSalvar: (id: string, dados: { nome?: string; cor?: string; ativo?: boolean }) => void;
  onClassificar: (id: string, valor: string) => void;
}) {
  const [nome, setNome] = useState(categoria.nome);
  const [cor, setCor] = useState(categoria.cor);

  // A categoria pode mudar por fora (recarga apos salvar): reflete de volta.
  useEffect(() => setNome(categoria.nome), [categoria.nome]);
  useEffect(() => setCor(categoria.cor), [categoria.cor]);

  function confirmarNome() {
    const limpo = nome.trim();
    if (!limpo || limpo === categoria.nome) {
      setNome(categoria.nome);
      return;
    }
    onSalvar(categoria.id, { nome: limpo });
  }

  return (
    <li className={cn("flex flex-wrap items-center gap-2", !categoria.ativo && "opacity-50")}>
      <input
        type="color"
        aria-label={`Cor de ${categoria.nome}`}
        value={cor}
        // `onChange` pinta a amostra na hora; quem SALVA e o `onBlur`. O
        // seletor de cor dispara change a cada movimento do cursor — no change
        // seria um PATCH por pixel arrastado.
        onChange={(e) => setCor(e.target.value)}
        onBlur={() => cor !== categoria.cor && onSalvar(categoria.id, { cor })}
        className="size-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      <Input
        aria-label={`Nome da categoria ${categoria.nome}`}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onBlur={confirmarNome}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setNome(categoria.nome);
        }}
        maxLength={80}
        className="h-9 min-w-[140px] flex-1"
      />

      {categoria.tipo === "despesa" && (
        <Select
          aria-label={`Classificação de ${categoria.nome} no DRE`}
          value={categoria.classificacao ?? ""}
          onChange={(e) => onClassificar(categoria.id, e.target.value)}
          className="h-9 w-56"
        >
          <option value="">Sem classificação</option>
          {CLASSIFICACOES_DRE.map((k) => (
            <option key={k} value={k}>
              {CLASSIFICACAO_DRE_ROTULO[k]}
            </option>
          ))}
        </Select>
      )}

      {/*
        Desativar, nao excluir: a categoria pode estar em lancamentos antigos, e
        apaga-la mudaria relatorio ja fechado. Inativa some do seletor de
        lancamento novo e continua valendo pro que ja existe.
      */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSalvar(categoria.id, { ativo: !categoria.ativo })}
        title={categoria.ativo ? "Desativar (some de novos lançamentos)" : "Reativar"}
      >
        {categoria.ativo ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </Button>
    </li>
  );
}
