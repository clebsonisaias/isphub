import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const ABAS = [
  { chave: "lancamentos", rotulo: "Lançamentos", to: "/financeiro" },
  { chave: "recorrencias", rotulo: "Recorrências", to: "/financeiro/recorrencias" },
  { chave: "parcelados", rotulo: "Parcelados", to: "/financeiro/parcelados" },
  { chave: "provisoes", rotulo: "Provisões", to: "/financeiro/provisoes" },
  { chave: "relatorios", rotulo: "Relatórios", to: "/financeiro/relatorios" },
] as const;

export type AbaFinanceiro = (typeof ABAS)[number]["chave"];

/**
 * Sub-navegacao do financeiro.
 *
 * Duas rotas em vez de uma tela com estado interno: cada uma carrega o proprio
 * conjunto de dados (a de relatorios faz quatro consultas agregadas), e URL
 * propria significa que da pra mandar o link do DRE pra alguem. Um `useState`
 * escondendo metade da tela nao teria como ser compartilhado nem recarregado.
 *
 * Nao entra na navegacao do cabecalho: la o Financeiro ja e UM item, e abrir
 * dois consumiria a linha que o menu de excesso ja disputa.
 */
export function FinanceiroTabs({ atual }: { atual: AbaFinanceiro }) {
  return (
    <nav aria-label="Seções do financeiro" className="flex gap-1 border-b border-border">
      {ABAS.map((aba) => {
        const ativa = aba.chave === atual;
        return (
          <Link
            key={aba.chave}
            to={aba.to}
            aria-current={ativa ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors pointer-coarse:min-h-11",
              ativa
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {aba.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
