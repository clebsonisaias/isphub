import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { credencialRastreamentoApi, type CredencialRastreamento } from "@/lib/veiculosApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { AlertTriangle, KeyRound, PlugZap } from "lucide-react";

/**
 * A credencial da PlataformaTK — trocar e testar.
 *
 * A rota (`PUT /frota/config`) existia desde a Fase 4 da frota e nunca teve
 * tela, o que deixava a troca de chave sem caminho nenhum pela interface. A
 * variavel de ambiente NAO serve pra isso: o seed so a usa quando ainda nao ha
 * credencial no banco, de proposito — "a variavel e o ponto de partida, nao a
 * autoridade", para que uma configuracao feita por um admin nao seja
 * sobrescrita no proximo deploy.
 *
 * **A chave nunca volta inteira do servidor**, so mascarada. O campo abaixo
 * escreve; ele nao le o que ja esta la.
 */
export function CredencialRastreamentoDialog({
  aberto,
  aoFechar,
}: {
  aberto: boolean;
  aoFechar: () => void;
}) {
  const { toast } = useToast();
  const [atual, setAtual] = useState<CredencialRastreamento | null | undefined>(undefined);
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; mensagem?: string } | null>(null);

  const carregar = useCallback(async () => {
    setAtual(undefined);
    setResultado(null);
    try {
      setAtual(await credencialRastreamentoApi.obter());
    } catch {
      setAtual(null);
    }
  }, []);

  useEffect(() => {
    if (aberto) {
      setChave("");
      void carregar();
    }
  }, [aberto, carregar]);

  async function salvar() {
    setSalvando(true);
    try {
      setAtual(await credencialRastreamentoApi.salvar(chave.trim()));
      setChave("");
      toast({
        titulo: "Credencial atualizada",
        // O que muda de verdade, dito na hora: a chave e por CONTA.
        descricao: "Teste a conexão — a chave é por conta, e a frota visível pode ter mudado.",
        variante: "sucesso",
      });
      await testar();
    } catch (e) {
      toast({
        titulo: "Não deu para salvar",
        descricao: e instanceof ApiError ? e.message : "Tente de novo em instantes.",
        variante: "erro",
      });
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTestando(true);
    try {
      setResultado(await credencialRastreamentoApi.testar());
    } catch (e) {
      setResultado({ ok: false, mensagem: e instanceof ApiError ? e.message : "Falha ao testar." });
    } finally {
      setTestando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" aria-hidden />
            Credencial do rastreamento
          </DialogTitle>
          <DialogDescription>
            A chave da PlataformaTK. Ela é vinculada a UMA conta do fornecedor — trocá-la troca a
            frota inteira que o ISPhub enxerga.
          </DialogDescription>
        </DialogHeader>

        {atual === undefined && <Skeleton className="h-24" />}

        {atual === null && (
          <p className="text-sm text-muted-foreground">
            Nenhuma credencial configurada ainda. Cole a chave abaixo.
          </p>
        )}

        {atual && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border p-3 text-sm">
            <dt className="text-muted-foreground">Chave em uso</dt>
            <dd className="font-mono">{atual.chaveMascarada}</dd>
            <dt className="text-muted-foreground">Coleta a cada</dt>
            <dd className="tabular-nums">{atual.intervaloPollingSegundos}s</dd>
            <dt className="text-muted-foreground">Última coleta</dt>
            <dd>
              {atual.ultimaColetaEm ? new Date(atual.ultimaColetaEm).toLocaleString("pt-BR") : "—"}
              {atual.ultimaColetaOk === false && (
                <span className="ml-1 text-destructive">(falhou)</span>
              )}
            </dd>
          </dl>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="cred-chave">Nova chave</Label>
          <Input
            id="cred-chave"
            value={chave}
            autoComplete="off"
            placeholder="Cole a chave fornecida pelo suporte da PlataformaTK"
            onChange={(e) => setChave(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Ela é guardada cifrada e não volta inteira para esta tela — só mascarada.
          </p>
        </div>

        {resultado && (
          <p
            role="status"
            className={`flex items-start gap-1.5 text-sm ${resultado.ok ? "text-success" : "text-destructive"}`}
          >
            {!resultado.ok && <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            {resultado.ok
              ? "Conexão OK — o fornecedor respondeu."
              : `Falhou: ${resultado.mensagem ?? "sem detalhe"}`}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => void testar()} disabled={testando || !atual}>
            <PlugZap className="size-4" aria-hidden />
            {testando ? "Testando…" : "Testar conexão"}
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando || chave.trim().length < 8}>
            {salvando ? "Salvando…" : "Salvar chave"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
