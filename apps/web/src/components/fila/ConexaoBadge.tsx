import { useEffect, useRef, useState } from "react";
import type { DetalhesTecnicos } from "@isphub/shared";
import { conexaoApi } from "@/lib/conexaoApi";
import { cn } from "@/lib/utils";
import { Wifi, WifiOff } from "lucide-react";

/**
 * Cache em memoria (por sessao de aba) pra nao repetir a consulta ao vivo
 * quando o mesmo card re-renderiza (troca de filtro/ordenação) ou volta a
 * ficar visível — espelha o TTL do cache do backend (ver conexao.ts).
 */
const CACHE_TTL_MS = 90_000;
const cache = new Map<string, { valor: DetalhesTecnicos | null; expiraEm: number }>();

/**
 * Status de conexão (online/offline) do cliente, direto no card da fila —
 * consulta ao vivo o SGP do provedor, mas só quando o card entra na tela
 * (IntersectionObserver) e com cache de 90s, pra uma página com dezenas de OS
 * não virar uma rajada de chamadas simultâneas (o backend também limita
 * concorrência por provedor, ver conexao.ts). O endereço completo NÃO entra
 * aqui (fica no dialog de detalhe, que já consulta) — evita duplicar o
 * endereço que o card já mostra no subtítulo e o layout shift da linha.
 */
export function ConexaoBadge({ provedorId, contratoId }: { provedorId: string; contratoId?: string | null }) {
  const [detalhes, setDetalhes] = useState<DetalhesTecnicos | null>(null);
  const [carregando, setCarregando] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!contratoId || !rootRef.current) return;
    const chave = `${provedorId}:${contratoId}`;

    const emCache = cache.get(chave);
    if (emCache && emCache.expiraEm > Date.now()) {
      setDetalhes(emCache.valor);
      return;
    }

    let cancelado = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        setCarregando(true);
        conexaoApi
          .detalhes(provedorId, contratoId)
          .then((r) => {
            cache.set(chave, { valor: r, expiraEm: Date.now() + CACHE_TTL_MS });
            if (!cancelado) setDetalhes(r);
          })
          .catch(() => {
            // Best-effort: falha na consulta ao vivo não deve poluir o card com erro.
            cache.set(chave, { valor: null, expiraEm: Date.now() + CACHE_TTL_MS });
          })
          .finally(() => {
            if (!cancelado) setCarregando(false);
          });
      },
      { rootMargin: "200px" },
    );
    observer.observe(rootRef.current);
    return () => {
      cancelado = true;
      observer.disconnect();
    };
  }, [provedorId, contratoId]);

  if (!contratoId) return null;

  // Espaço reservado de tamanho fixo: o badge carrega async, mas o slot ocupa
  // sempre o mesmo lugar (skeleton -> badge -> vazio), então a linha de badges
  // não re-flui ~1s depois do card aparecer (era um layout shift a cada scroll).
  return (
    <span ref={rootRef} className="inline-flex h-5 w-[4.75rem] items-center">
      {carregando && !detalhes ? (
        <span className="inline-flex h-4 w-16 animate-pulse rounded-full bg-secondary/60" />
      ) : detalhes?.online != null ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
            // Offline é sinal de atenção (destructive); online é neutro — cor
            // no card fica reservada pra urgência/SLA.
            detalhes.online
              ? "border-border bg-secondary/50 text-muted-foreground"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {detalhes.online ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
          {detalhes.online ? "Online" : "Offline"}
        </span>
      ) : null}
    </span>
  );
}
