import { useState } from "react";
import type { FilaItem } from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rotuloLongo } from "@/lib/marcarVisita";
import { cn } from "@/lib/utils";

const MOTIVOS_RAPIDOS = ["A internet voltou", "Cliente desistiu da visita", "Resolvido por telefone", "OS aberta por engano"];
const MOTIVO_MINIMO = 10;

/** Encerrar sem visita: motivo obrigatório (vai para o SGP com o nome de quem encerrou) e confirmação. */
export function EncerrarOsDialog(props: {
  os: FilaItem;
  aberto: boolean;
  enviando: boolean;
  onFechar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const { os } = props;
  const [motivo, setMotivo] = useState("");
  const pronto = motivo.trim().length >= MOTIVO_MINIMO;

  return (
    <Dialog open={props.aberto} onOpenChange={(o) => !o && props.onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encerrar a OS {os.sgpOsId}?</DialogTitle>
          <DialogDescription>{os.clienteNome ?? "Cliente não identificado"}</DialogDescription>
        </DialogHeader>

        <p className="text-sm">
          A OS fecha no ISPhub e no SGP, sem visita. No SGP fica anotado que foi você e o motivo.
          {os.diaAgenda && os.turnoAgenda ? ` A visita de ${rotuloLongo(os.diaAgenda, os.turnoAgenda)} será desmarcada.` : ""}
        </p>

        <div className="flex flex-col gap-2">
          <Label htmlFor="motivo-encerrar">Motivo</Label>
          <div className="flex flex-wrap gap-2">
            {MOTIVOS_RAPIDOS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={motivo === m}
                onClick={() => setMotivo(m)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  motivo === m ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-secondary",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <Textarea
            id="motivo-encerrar"
            rows={3}
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Escolha acima ou escreva o motivo"
          />
          {!pronto && motivo.trim().length > 0 ? (
            <span className="text-xs text-muted-foreground">Escreva pelo menos {MOTIVO_MINIMO} letras.</span>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={props.onFechar}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={!pronto || props.enviando} onClick={() => props.onConfirmar(motivo.trim())}>
            {props.enviando ? "Encerrando…" : `Encerrar OS ${os.sgpOsId}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
