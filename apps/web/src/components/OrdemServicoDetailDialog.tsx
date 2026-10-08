import { useState } from "react";
import type { FilaItem } from "@isphub/shared";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { OrdemServicoDetalhe } from "@/components/OrdemServicoDetalhe";

/** Atalho da fila: o detalhe da OS num dialogo. A pagina /os/:id e o mesmo
 *  corpo, pra quem quer link ou outra aba. */
export function OrdemServicoDetailDialog({
  item,
  onClose,
  onAtualizado,
}: {
  item: FilaItem;
  onClose: () => void;
  onAtualizado: () => void;
}) {
  const [houveMudanca, setHouveMudanca] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        if (houveMudanca) onAtualizado();
        else onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <OrdemServicoDetalhe item={item} emDialogo onMudanca={() => setHouveMudanca(true)} />
      </DialogContent>
    </Dialog>
  );
}
