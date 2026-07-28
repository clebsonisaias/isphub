import { useEffect, useState } from "react";
import type { OsEvento } from "@isphub/shared";
import { ordensServicoApi } from "@/lib/filaApi";
import { ApiError } from "@/lib/apiClient";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { UserPlus, RefreshCw, MessageSquare, Camera, Pencil, type LucideIcon } from "lucide-react";

const ICONE_POR_TIPO: Record<OsEvento["tipo"], LucideIcon> = {
  atribuicao: UserPlus,
  status: RefreshCw,
  anotacao: MessageSquare,
  foto: Camera,
  edicao: Pencil,
};

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/** Timeline de uma OS (status, anotações, atribuições, fotos) — busca ao montar. */
export function OsTimeline({ ordemServicoId }: { ordemServicoId: string }) {
  const [eventos, setEventos] = useState<OsEvento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    ordensServicoApi
      .eventos(ordemServicoId)
      .then((r) => {
        if (!cancelado) setEventos(r);
      })
      .catch((err) => {
        if (!cancelado) setErro(mensagem(err));
      });
    return () => {
      cancelado = true;
    };
  }, [ordemServicoId, tentativa]);

  if (erro) return <ErrorState message={erro} onRetry={() => setTentativa((n) => n + 1)} />;
  if (!eventos) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex-1 flex-col gap-1.5">
              <Skeleton className="mb-1.5 h-3.5 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (eventos.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>;
  }

  return (
    <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
      {eventos.map((e) => {
        const Icone = ICONE_POR_TIPO[e.tipo];
        return (
          <div key={e.id} className="flex gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <Icone className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{e.descricao}</p>
              <p className="text-xs text-muted-foreground">
                {e.autorNome ?? "Sistema"} · {new Date(e.criadoEm).toLocaleString("pt-BR")}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
