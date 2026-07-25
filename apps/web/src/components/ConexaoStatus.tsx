import { useState } from "react";
import type { ConnectionStatus } from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { conexaoApi } from "@/lib/conexaoApi";
import { ApiError } from "@/lib/apiClient";
import { Wifi, WifiOff, RadioTower } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Consulta ao vivo (sob demanda, botao) se o servico do contrato esta
 * online/offline no SGP agora. Nao roda automaticamente no sync em massa —
 * e uma chamada por contrato, entao so busca quando o usuario pede.
 */
export function ConexaoStatus({ provedorId, contratoId }: { provedorId: string; contratoId?: string | null }) {
  const [resultado, setResultado] = useState<ConnectionStatus | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!contratoId) return null;

  async function verificar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await conexaoApi.verificar(provedorId, contratoId!);
      setResultado(r);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Falha ao consultar o SGP");
    } finally {
      setCarregando(false);
    }
  }

  if (!resultado && !erro) {
    return (
      <Button variant="outline" size="sm" onClick={verificar} disabled={carregando}>
        <RadioTower className={cn("size-3.5", carregando && "animate-pulse")} />
        {carregando ? "Consultando SGP..." : "Verificar conexão"}
      </Button>
    );
  }

  if (erro) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        Não foi possível verificar ({erro})
        <button type="button" onClick={verificar} className="underline hover:text-foreground">
          tentar de novo
        </button>
      </span>
    );
  }

  const online = resultado!.online;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        online === true && "border-success/40 bg-success/10 text-success",
        online === false && "border-destructive/40 bg-destructive/10 text-destructive",
        online === null && "border-border bg-secondary/50 text-muted-foreground",
      )}
    >
      {online === true && <Wifi className="size-3" />}
      {online === false && <WifiOff className="size-3" />}
      {resultado!.mensagem ?? "Status indisponível"}
    </span>
  );
}
