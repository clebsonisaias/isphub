import type { Categoria, Provedor } from "@isphub/shared";
import { OS_STATUS_LABEL, PRIORIDADE_LABEL, type FilaFacetState } from "@/lib/filaFacets";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/** Dimensões de filtro que viram chip (a busca entra separada). */
type Dimensao = "status" | "prioridade" | "categoriaId" | "provedorId" | "tecnicoId";

interface ChipInfo {
  dim: Dimensao | "busca";
  rotulo: string;
}

interface Props {
  filtros: FilaFacetState;
  /** Texto de busca (estado separado dos filtros de faceta no Painel). */
  busca: string;
  categorias: Categoria[];
  provedores: Provedor[];
  /** Nome do tecnico filtrado, resolvido pelas facetas (o cadastro nao e consultado aqui). */
  nomeTecnico?: string | null;
  /** Remove uma dimensão (volta ao valor "todos/todas"); "busca" limpa o texto. */
  onRemover: (dim: Dimensao | "busca") => void;
  onLimpar: () => void;
}

/**
 * Linha de chips dos filtros ativos, acima da lista. Torna visível *por que* a
 * lista está curta (antes o usuário via poucos itens sem pista do filtro) e dá
 * um "×" por dimensão + um "Limpar filtros" geral.
 */
export function FilaChipsAtivos({
  filtros,
  busca,
  categorias,
  provedores,
  nomeTecnico,
  onRemover,
  onLimpar,
}: Props) {
  const shouldReduceMotion = useReducedMotion();
  const chips: ChipInfo[] = [];

  if (filtros.status !== "todos") {
    chips.push({ dim: "status", rotulo: `Status: ${OS_STATUS_LABEL[filtros.status]}` });
  }
  if (filtros.prioridade !== "todas") {
    chips.push({ dim: "prioridade", rotulo: `Prioridade: ${PRIORIDADE_LABEL[filtros.prioridade]}` });
  }
  if (filtros.categoriaId !== "todas") {
    const nome =
      filtros.categoriaId === "sem_categoria"
        ? "Não classificado"
        : (categorias.find((c) => c.id === filtros.categoriaId)?.nome ?? "Categoria");
    chips.push({ dim: "categoriaId", rotulo: `Categoria: ${nome}` });
  }
  if (filtros.provedorId !== "todos") {
    const nome = provedores.find((p) => p.id === filtros.provedorId)?.nome ?? "Provedor";
    chips.push({ dim: "provedorId", rotulo: `Provedor: ${nome}` });
  }
  if (filtros.tecnicoId !== "todos") {
    // O nome do tecnico vem das proprias OS (facetas), nao do cadastro — por
    // isso chega pronto por prop em vez de ser resolvido aqui.
    const rotulo = filtros.tecnicoId === "a_despachar" ? "A despachar" : (nomeTecnico ?? "Técnico");
    chips.push({ dim: "tecnicoId", rotulo: `Despacho: ${rotulo}` });
  }
  if (busca.trim()) {
    chips.push({ dim: "busca", rotulo: `Busca: "${busca.trim()}"` });
  }

  return (
    <AnimatePresence>
      {chips.length > 0 && (
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="mb-3 flex flex-wrap items-center gap-2 overflow-hidden"
        >
          <AnimatePresence initial={false}>
            {chips.map((chip) =>
              shouldReduceMotion ? (
                <button
                  key={chip.dim}
                  type="button"
                  onClick={() => onRemover(chip.dim)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  {chip.rotulo}
                  <X className="size-3.5" />
                </button>
              ) : (
                <motion.button
                  key={chip.dim}
                  type="button"
                  layout="position"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  onClick={() => onRemover(chip.dim)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  {chip.rotulo}
                  <X className="size-3.5" />
                </motion.button>
              ),
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={onLimpar}
            className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Limpar filtros
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
