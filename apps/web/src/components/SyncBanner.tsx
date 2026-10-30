import { useSync } from "@/context/SyncContext";
import { Button } from "@/components/ui/button";
import { RefreshCw, WifiOff, CloudUpload } from "lucide-react";
import { useState } from "react";

export function SyncBanner() {
  const { status, pendencias, sincronizarAgora } = useSync();
  const [tentando, setTentando] = useState(false);

  // Se estiver 100% online e sem nenhuma pendência, não ocupa espaço na tela
  if (status === "online" && pendencias === 0) {
    return null;
  }

  async function handleSincronizar() {
    setTentando(true);
    try {
      await sincronizarAgora();
    } finally {
      setTentando(false);
    }
  }

  return (
    <div
      role="status"
      className={`relative z-40 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs font-medium transition-colors ${
        status === "offline"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-primary/30 bg-primary/10 text-primary"
      }`}
    >
      <div className="flex items-center gap-2">
        {status === "offline" ? (
          <WifiOff className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <RefreshCw className="size-4 shrink-0 animate-spin text-primary" />
        )}
        <span>
          {status === "offline" ? (
            <>
              <strong>Modo Rua Offline:</strong> Sem sinal de internet. Suas ações estão seguras no aparelho
              {pendencias > 0 ? ` (${pendencias} ${pendencias === 1 ? "ação pendente" : "ações pendentes"})` : ""}.
            </>
          ) : (
            <>
              <strong>Sincronizando:</strong> Enviando dados para a central...
              {pendencias > 0 ? ` (${pendencias} restantes)` : ""}
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleSincronizar}
          disabled={tentando || status === "sincronizando"}
          className="h-7 px-2.5 text-xs border-current hover:bg-current/10"
        >
          {tentando ? (
            <RefreshCw className="size-3 animate-spin mr-1" />
          ) : (
            <CloudUpload className="size-3 mr-1" />
          )}
          {status === "offline" ? "Testar conexão" : "Sincronizar agora"}
        </Button>
      </div>
    </div>
  );
}
