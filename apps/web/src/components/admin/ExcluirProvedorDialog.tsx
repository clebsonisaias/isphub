import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/context/ToastContext";
import { provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

interface ExcluirProvedorDialogProps {
  provedor: { id: string; nome: string } | null;
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  onExcluido?: () => void;
}

export function ExcluirProvedorDialog({
  provedor,
  aberto,
  onOpenChange,
  onExcluido,
}: ExcluirProvedorDialogProps) {
  const { toast } = useToast();
  const [confirmacao, setConfirmacao] = useState("");
  const [excluindo, setExcluindo] = useState(false);

  if (!provedor) return null;

  const nomeExato = provedor.nome.trim();
  const podeExcluir = confirmacao.trim().toLowerCase() === nomeExato.toLowerCase();

  async function handleExcluir() {
    if (!podeExcluir || excluindo || !provedor) return;

    setExcluindo(true);
    try {
      await provedoresApi.remover(provedor.id);
      toast({
        titulo: "Provedor excluído",
        descricao: `O provedor "${provedor.nome}" e seus dados vinculados foram removidos com sucesso.`,
        variante: "sucesso",
      });
      setConfirmacao("");
      onOpenChange(false);
      onExcluido?.();
    } catch (err) {
      toast({
        titulo: "Erro ao excluir provedor",
        descricao: err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor",
        variante: "erro",
      });
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!excluindo) {
          setConfirmacao("");
          onOpenChange(v);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5 shrink-0" />
            <DialogTitle>Excluir provedor definitivamente?</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-left text-sm leading-relaxed text-muted-foreground">
            Esta ação é <strong className="text-foreground">irreversível</strong>. Ao excluir o provedor{" "}
            <span className="font-semibold text-foreground">"{provedor.nome}"</span>, todas as ordens de serviço,
            agendamentos, vínculos de técnicos e configurações de ERP associados serão excluídos do sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 flex flex-col gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
          <p>
            Para confirmar, digite o nome do provedor <strong className="font-bold underline">{nomeExato}</strong> abaixo:
          </p>
          <div className="mt-1 flex flex-col gap-1">
            <Label htmlFor="confirmacao-nome-provedor" className="sr-only">
              Nome do provedor para confirmação
            </Label>
            <Input
              id="confirmacao-nome-provedor"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              placeholder={nomeExato}
              disabled={excluindo}
              className="bg-background text-foreground"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={excluindo}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleExcluir}
            disabled={!podeExcluir || excluindo}
            className="gap-1.5"
          >
            {excluindo ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Excluindo...
              </>
            ) : (
              <>
                <Trash2 className="size-4" />
                Excluir provedor
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
