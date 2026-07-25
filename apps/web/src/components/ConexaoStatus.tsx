import { useState } from "react";
import type { DetalhesTecnicos } from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { conexaoApi } from "@/lib/conexaoApi";
import { ApiError } from "@/lib/apiClient";
import { Wifi, WifiOff, RadioTower, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

/** Sinal optico da ONU normal fica entre -8 e -27 dBm; fora disso e alerta. */
function sinalOk(dbm: number | null): boolean | null {
  if (dbm == null) return null;
  return dbm <= -8 && dbm >= -27;
}

/**
 * Consulta ao vivo (sob demanda, botao) os detalhes tecnicos do contrato no
 * SGP: online/offline, sinal optico da ONU (rx/tx) e endereco completo. Nao
 * roda automaticamente no sync em massa — e uma chamada por contrato, entao
 * so busca quando o usuario pede.
 */
export function ConexaoStatus({
  provedorId,
  contratoId,
  onDetalhes,
}: {
  provedorId: string;
  contratoId?: string | null;
  /** Chamado com o resultado ao carregar, para o dialog pai exibir endereço/bairro. */
  onDetalhes?: (detalhes: DetalhesTecnicos) => void;
}) {
  const [resultado, setResultado] = useState<DetalhesTecnicos | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!contratoId) return null;

  async function verificar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await conexaoApi.detalhes(provedorId, contratoId!);
      setResultado(r);
      onDetalhes?.(r);
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
        {carregando ? "Consultando SGP..." : "Verificar conexão e sinal"}
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

  const { online, sinalRxDbm, sinalTxDbm, mensagem } = resultado!;
  const okSinal = sinalOk(sinalRxDbm);

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
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
        {mensagem ?? "Status indisponível"}
      </span>

      {sinalRxDbm != null && (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
            okSinal === true && "border-success/40 bg-success/10 text-success",
            okSinal === false && "border-warning/40 bg-warning/10 text-warning",
          )}
          title={sinalTxDbm != null ? `TX: ${sinalTxDbm} dBm` : undefined}
        >
          <Gauge className="size-3" />
          Sinal ONU: {sinalRxDbm} dBm
        </span>
      )}
    </div>
  );
}
