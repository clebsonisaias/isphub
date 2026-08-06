import { useMemo, useState } from "react";
import {
  STATUS_CONTRATO,
  alvosPermitidos,
  rotuloDoTexto,
  type CodigoStatusContrato,
  type OrdemServico,
} from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { ordensServicoApi } from "@/lib/filaApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { AlertTriangle, PlugZap } from "lucide-react";

/**
 * Mudar o status do CONTRATO no SGP, a partir da OS.
 *
 * DUAS FORMAS, decididas pelo que o papel alcança — não por `if (role)` espalhado:
 *
 *  - quem pode mudar para vários status vê um seletor;
 *  - quem só tem UMA transição possível (o técnico, em contrato inativo) vê um
 *    botão de ação direta. Um seletor com uma opção só é um clique a mais para
 *    dizer o óbvio, e quem está na rua não tem tempo para isso.
 *
 * A lista sai de `alvosPermitidos`, a MESMA função que o servidor usa pra
 * recusar. Duas cópias divergiriam e a tela ofereceria o que a API nega.
 */
export function ContratoStatusAcao({
  os,
  onAtualizado,
}: {
  os: OrdemServico;
  onAtualizado: (os: OrdemServico) => void;
}) {
  const { usuario } = useAuth();
  const { toast } = useToast();
  const [alvo, setAlvo] = useState<CodigoStatusContrato | "">("");
  const [confirmando, setConfirmando] = useState<CodigoStatusContrato | null>(null);
  const [enviando, setEnviando] = useState(false);

  const role = usuario?.role;
  const alvos = useMemo(
    () => (role ? alvosPermitidos(role, os.contratoStatus) : []),
    [role, os.contratoStatus],
  );

  // Sem contrato vinculado não há o que mudar — e a API responde 409.
  if (!os.contratoId || !role || alvos.length === 0) return null;

  const atual = rotuloDoTexto(os.contratoStatus);
  /** Uma opção só = ação direta. É o caso do técnico reativando. */
  const acaoUnica = alvos.length === 1 ? alvos[0] : null;

  async function aplicar(codigo: CodigoStatusContrato) {
    setEnviando(true);
    try {
      const atualizado = await ordensServicoApi.mudarContratoStatus(os.id, codigo);
      toast({
        titulo: `Contrato agora está ${STATUS_CONTRATO[codigo]}`,
        descricao: "A mudança foi gravada no SGP.",
        variante: "sucesso",
      });
      onAtualizado(atualizado);
      setAlvo("");
      setConfirmando(null);
    } catch (err) {
      toast({
        titulo: "Não deu para mudar o contrato",
        // A mensagem da API importa: um 403 explica QUAL regra barrou.
        descricao: err instanceof ApiError ? err.message : undefined,
        variante: "erro",
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-secondary/30 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">Status do contrato</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Contrato {os.contratoId} · atualmente <span className="font-medium text-foreground">{atual}</span>
        </p>
      </div>

      {acaoUnica ? (
        <Button size="sm" onClick={() => setConfirmando(acaoUnica)} disabled={enviando}>
          <PlugZap className="size-4" aria-hidden />
          {/* "Reativar" em vez de "Mudar para Ativo": é o que a pessoa quer fazer. */}
          {acaoUnica === 1 ? "Reativar contrato" : `Mudar para ${STATUS_CONTRATO[acaoUnica]}`}
        </Button>
      ) : (
        <>
          <Select
            aria-label="Novo status do contrato"
            value={alvo}
            onChange={(e) => setAlvo(e.target.value ? (Number(e.target.value) as CodigoStatusContrato) : "")}
          >
            <option value="">Mudar para…</option>
            {alvos.map((c) => (
              <option key={c} value={c}>
                {STATUS_CONTRATO[c]}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!alvo || enviando} onClick={() => alvo && setConfirmando(alvo)}>
            Aplicar
          </Button>
        </>
      )}

      <ConfirmacaoDialog
        os={os}
        alvo={confirmando}
        atual={atual}
        enviando={enviando}
        onFechar={() => setConfirmando(null)}
        onConfirmar={aplicar}
      />
    </div>
  );
}

/**
 * Confirmação obrigatória — inclusive para o técnico.
 *
 * Isto escreve no ERP de produção do provedor: cancelar derruba o serviço de um
 * cliente real, e reativar libera. Um clique acidental na lista não pode ter
 * esse efeito.
 */
function ConfirmacaoDialog({
  os,
  alvo,
  atual,
  enviando,
  onFechar,
  onConfirmar,
}: {
  os: OrdemServico;
  alvo: CodigoStatusContrato | null;
  atual: string;
  enviando: boolean;
  onFechar: () => void;
  onConfirmar: (c: CodigoStatusContrato) => void;
}) {
  const [ultimo, setUltimo] = useState<CodigoStatusContrato | null>(alvo);
  if (alvo && alvo !== ultimo) setUltimo(alvo);
  const codigo = alvo ?? ultimo;
  if (!codigo) return null;

  // Cancelar e suspender tiram o cliente do ar — merecem aviso, não só confirmação.
  const derrubaCliente = codigo === 3 || codigo === 4;

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mudar status do contrato</DialogTitle>
          <DialogDescription>
            Contrato {os.contratoId} de {os.clienteNome ?? "cliente não identificado"}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm">
          <span className="text-muted-foreground">{atual}</span>
          <span className="mx-2" aria-hidden>
            →
          </span>
          <span className="font-semibold">{STATUS_CONTRATO[codigo]}</span>
        </p>

        {derrubaCliente && (
          <p
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
            <span>Isso tira o cliente do ar imediatamente.</span>
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          A mudança é gravada no SGP e fica registrada no histórico desta OS com o seu nome.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant={derrubaCliente ? "destructive" : "brand"}
            disabled={enviando}
            onClick={() => onConfirmar(codigo)}
          >
            {enviando ? "Aplicando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
