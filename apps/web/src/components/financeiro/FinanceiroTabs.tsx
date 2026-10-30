import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const ABAS = [
  { chave: "lancamentos", rotulo: "Lançamentos", to: "/financeiro" },
  /*
   * "Pontuais" e "Serviços" nao sao telas novas: sao a MESMA lista com um
   * recorte. E assim na origem tambem — as duas abas dela compartilham a tabela
   * `lancamentos_pontuais`, distinguidas por um campo. Duas telas quase iguais
   * seriam duas coisas pra manter e um lugar a mais pra divergir.
   */
  { chave: "pontuais", rotulo: "Pontuais", to: "/financeiro?origem=avulso" },
  { chave: "servicos", rotulo: "Serviços", to: "/financeiro?servico=true" },
  { chave: "recorrencias", rotulo: "Recorrências", to: "/financeiro/recorrencias" },
  { chave: "parcelados", rotulo: "Parcelados", to: "/financeiro/parcelados" },
  { chave: "provisoes", rotulo: "Provisões", to: "/financeiro/provisoes" },
  { chave: "frota", rotulo: "Frota", to: "/financeiro/frota" },
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
    <nav aria-label="Seções do financeiro" className="flex gap-1 overflow-x-auto border-b border-border scrollbar-none">
      {ABAS.map((aba) => {
        const ativa = aba.chave === atual;
        return (
          <Link
            key={aba.chave}
            to={aba.to}
            aria-current={ativa ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors pointer-coarse:min-h-11",
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
