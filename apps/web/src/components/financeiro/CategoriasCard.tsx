import { useState } from "react";
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
import { Plus } from "lucide-react";

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
                <li key={c.id} className="flex flex-wrap items-center gap-3">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.cor }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">{c.nome}</span>
                  <Select
                    aria-label={`Classificação de ${c.nome} no DRE`}
                    value={c.classificacao ?? ""}
                    onChange={(e) => void classificar(c.id, e.target.value)}
                    className="w-64"
                  >
                    <option value="">Sem classificação</option>
                    {CLASSIFICACOES_DRE.map((k) => (
                      <option key={k} value={k}>
                        {CLASSIFICACAO_DRE_ROTULO[k]}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        )}

        {receitas.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Receitas</h3>
            <ul className="flex flex-wrap gap-2">
              {receitas.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: c.cor }} aria-hidden />
                  {c.nome}
                </li>
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
