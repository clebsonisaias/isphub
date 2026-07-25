import type { FilaItem } from "@isphub/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";

type OcorrenciaItem = Extract<FilaItem, { kind: "ocorrencia" }>;

/**
 * Detalhe de Ocorrencia — somente leitura (o SGP nao expoe write-back para
 * ocorrencias na API do ISPhub, so para OS; ver plano). Mostra tudo que o
 * SGP realmente manda: cliente, datas de abertura/finalizacao, localizacao
 * (POP — o SGP nao tem endereco de rua nessas listagens), metodo de
 * contato, responsavel e status do contrato.
 */
export function OcorrenciaDetailDialog({ item, onClose }: { item: OcorrenciaItem; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <ProvedorBadge provedor={item.provedor} />
            <span className="rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {item.status ?? "—"}
            </span>
            <ContratoStatusBadge status={item.contratoStatus} />
          </div>
          <DialogTitle>{item.clienteNome ?? "Cliente não identificado"}</DialogTitle>
          <DialogDescription>
            {item.tipo ?? "Ocorrência"} · SGP #{item.sgpNumero}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Info label="Contrato" value={item.contratoId} />
          <Info label="Localização (POP)" value={item.pop} />
          <Info label="Método" value={item.metodo} />
          <Info label="Responsável" value={item.responsavel} />
          <Info
            label="Aberta em"
            value={item.dataCadastro ? new Date(item.dataCadastro).toLocaleString("pt-BR") : undefined}
          />
          <Info
            label="Finalizada em"
            value={item.dataFinalizacao ? new Date(item.dataFinalizacao).toLocaleString("pt-BR") : undefined}
          />
          <Info
            label="Agendamento"
            value={item.dataAgendamento ? new Date(item.dataAgendamento).toLocaleString("pt-BR") : undefined}
          />
          <Info label="Registrado por" value={item.usuario} />
        </div>

        {item.conteudo && (
          <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
            {item.conteudo}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}
