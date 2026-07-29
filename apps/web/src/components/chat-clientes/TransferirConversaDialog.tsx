import { useEffect, useState } from "react";
import { USER_ROLE_LABEL, type ContatoChat } from "@isphub/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/Avatar";
import { ApiError } from "@/lib/apiClient";
import { chatApi } from "@/lib/chatApi";
import { clientesChatApi } from "@/lib/clientesChatApi";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/**
 * Troca o DONO da conversa (ADMIN/GESTOR). É a ação explícita, oposta à
 * intervenção: quem intervém escreve sem tirar a conversa de quem atende.
 * A lista de destinos vem dos contatos do chat interno — mesmos papéis de staff,
 * já sem PROVEDOR e sem o próprio usuário.
 */
export function TransferirConversaDialog({
  open,
  onOpenChange,
  conversaId,
  agenteAtualId,
  onTransferida,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversaId: string;
  agenteAtualId?: string | null;
  onTransferida: (agenteId: string, agenteNome: string) => void;
}) {
  const { toast } = useToast();
  const [contatos, setContatos] = useState<ContatoChat[] | null>(null);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [transferindo, setTransferindo] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelecionadoId(null);
    setContatos(null);
    let vivo = true;
    chatApi
      .contatos()
      .then((lista) => vivo && setContatos(lista))
      .catch(() => vivo && setContatos([]));
    return () => {
      vivo = false;
    };
  }, [open]);

  async function handleTransferir() {
    const destino = (contatos ?? []).find((c) => c.id === selecionadoId);
    if (!destino) return;
    setTransferindo(true);
    try {
      await clientesChatApi.transferir(conversaId, destino.id);
      onTransferida(destino.id, destino.nome);
      onOpenChange(false);
      toast({ titulo: `Conversa passada para ${destino.nome}`, variante: "sucesso" });
    } catch (err) {
      toast({ titulo: "Não foi possível transferir", descricao: mensagem(err), variante: "erro" });
    } finally {
      setTransferindo(false);
    }
  }

  const destinos = (contatos ?? []).filter((c) => c.id !== agenteAtualId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Passar para outro atendente</DialogTitle>
          <DialogDescription>Quem receber passa a ser o dono da conversa e responde por ela daqui pra frente.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label>Atendente</Label>
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {contatos === null ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Carregando…
              </p>
            ) : destinos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum outro atendente disponível.</p>
            ) : (
              destinos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelecionadoId(c.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary",
                    selecionadoId === c.id && "bg-secondary",
                  )}
                >
                  <Avatar nome={c.nome} online={c.online} size="sm" />
                  <span className="text-sm text-foreground">{c.nome}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{USER_ROLE_LABEL[c.role]}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={transferindo}>
            Cancelar
          </Button>
          <Button variant="brand" onClick={handleTransferir} disabled={!selecionadoId || transferindo}>
            {transferindo ? "Passando..." : "Passar conversa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
