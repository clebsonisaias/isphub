import { FilaWorkspace } from "@/components/fila/FilaWorkspace";

/**
 * Pendentes: OS em status PENDENTE — geralmente a instalação foi tentada várias
 * vezes sem retorno do cliente. Saem do Painel e do despacho e ficam aqui sem
 * técnico (a API desvincula) até alguém retomar mudando o status. Só as da
 * equipe interna: retirada pendente continua em Retiradas, que é de outra equipe.
 */
export function PendentesPage() {
  return (
    <FilaWorkspace
      equipe="interna"
      pendentes="so"
      titulo="Pendentes"
      subtitulo="OS em que a instalação ou o atendimento não foi concluído, por exemplo cliente sem retorno. Ficam aqui sem técnico até alguém retomar."
      rotuloAbertas="Pendentes"
      rotuloEstatAbertas="Pendentes"
      vazioAbertas="Nenhuma OS pendente."
    />
  );
}
