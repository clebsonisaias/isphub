import { FilaWorkspace } from "@/components/fila/FilaWorkspace";

/**
 * Retiradas/cancelamentos: OS executadas por equipes de FORA (categorias
 * marcadas com equipeExterna=true em /admin/categorias). Tela separada de
 * propósito — misturá-las no Painel fazia a equipe da ISPhub ver como
 * trabalho seu uma fila que ela não executa.
 */
export function RetiradasPage() {
  return (
    <FilaWorkspace
      equipe="externa"
      titulo="Retiradas"
      subtitulo="Retirada e cancelamento de equipamento — executadas por equipes de fora, não pela equipe da ISPhub."
      rotuloAbertas="A retirar"
      rotuloEstatAbertas="A retirar"
      vazioAbertas="Nenhuma retirada pendente."
      vazioConcluidas="Nenhuma retirada concluída ainda."
      dicaSemCategorias="Nenhuma categoria está marcada como executada por outra equipe. Marque em Administração → Categorias."
    />
  );
}
