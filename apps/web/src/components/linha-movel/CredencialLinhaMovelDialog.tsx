import { rotuloDataHora } from "@isphub/shared";
import { useCallback, useEffect, useState } from "react";
import type { TesteConexao } from "@isphub/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { linhaMovelApi, type ConfigLinhaMovel } from "@/lib/linhaMovelApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { AlertTriangle, KeyRound, PlugZap } from "lucide-react";

/**
 * A credencial da telefonia móvel (Brazmóvel/CITmax).
 *
 * **O token nunca volta do servidor — nem mascarado.** Diferente da chave do
 * rastreamento, que a tela mostra parcialmente: este token é do PARCEIRO e
 * enxerga a base inteira da operadora, então não há forma útil de exibi-lo que
 * compense o risco. O campo abaixo escreve; ele não lê o que já está lá.
 *
 * O botão "Testar conexão" sonda um CPF válido e inexistente: a operadora
 * responde 404 (token bom) ou 401 (token recusado), e a mensagem distingue os
 * dois. Sem essa distinção o admin ficaria trocando um token que já está certo.
 */
export function CredencialLinhaMovelDialog({
  aberto,
  aoFechar,
}: {
  aberto: boolean;
  aoFechar: () => void;
}) {
  const { toast } = useToast();
  const [atual, setAtual] = useState<ConfigLinhaMovel | null | undefined>(undefined);
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<TesteConexao | null>(null);

  const carregar = useCallback(async () => {
    setAtual(undefined);
    setResultado(null);
    try {
      setAtual(await linhaMovelApi.obterConfig());
    } catch {
      setAtual(null);
    }
  }, []);

  useEffect(() => {
    if (aberto) {
      setToken("");
      void carregar();
    }
  }, [aberto, carregar]);

  const testar = useCallback(async () => {
    setTestando(true);
    try {
      setResultado(await linhaMovelApi.testar());
    } catch (e) {
      setResultado({
        ok: false,
        httpStatus: null,
        detalhe: e instanceof ApiError ? e.message : "Falha ao testar.",
      });
    } finally {
      setTestando(false);
    }
  }, []);

  async function salvar() {
    setSalvando(true);
    try {
      setAtual(await linhaMovelApi.salvarConfig({ token: token.trim() }));
      setToken("");
      toast({ titulo: "Credencial salva", variante: "sucesso" });
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

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" aria-hidden />
            Credencial da telefonia móvel
          </DialogTitle>
          <DialogDescription>
            O token da Brazmóvel. Ele é do parceiro e enxerga a base inteira da operadora — por isso
            é guardado cifrado e nunca volta para esta tela.
          </DialogDescription>
        </DialogHeader>

        {atual === undefined && <Skeleton className="h-20" />}

        {atual === null && (
          <p className="text-sm text-muted-foreground">
            Integração ainda não configurada. Cole o token abaixo.
          </p>
        )}

        {atual && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border p-3 text-sm">
            <dt className="text-muted-foreground">Endereço</dt>
            <dd className="truncate font-mono text-xs">{atual.baseUrl}</dd>
            <dt className="text-muted-foreground">Último teste</dt>
            <dd>
              {atual.ultimoTesteEm ? rotuloDataHora(atual.ultimoTesteEm) : "—"}
              {atual.ultimoTesteOk === false && <span className="ml-1 text-destructive">(falhou)</span>}
            </dd>
            {atual.ultimoTesteMensagem && (
              <>
                <dt className="text-muted-foreground">Resposta</dt>
                <dd className="font-mono text-xs">{atual.ultimoTesteMensagem}</dd>
              </>
            )}
          </dl>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="lm-token">{atual ? "Novo token" : "Token"}</Label>
          <Input
            id="lm-token"
            value={token}
            autoComplete="off"
            placeholder="Cole o token fornecido pela Brazmóvel"
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Guardado cifrado. Trocar o token descarta o resultado do teste anterior — ele provou a
            credencial antiga.
          </p>
        </div>

        {resultado && (
          <p
            role="status"
            className={`flex items-start gap-1.5 text-sm ${resultado.ok ? "text-success" : "text-destructive"}`}
          >
            {!resultado.ok && <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            {resultado.ok
              ? "Conexão OK — a operadora respondeu com esta credencial."
              : `${resultado.detalhe ?? "Falhou"}${resultado.httpStatus ? ` (HTTP ${resultado.httpStatus})` : ""}`}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => void testar()} disabled={testando || !atual}>
            <PlugZap className="size-4" aria-hidden />
            {testando ? "Testando…" : "Testar conexão"}
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando || token.trim().length < 10}>
            {salvando ? "Salvando…" : "Salvar token"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
