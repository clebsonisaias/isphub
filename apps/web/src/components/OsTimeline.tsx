import { useEffect, useState } from "react";
import type { OsEvento } from "@isphub/shared";
import { ordensServicoApi } from "@/lib/filaApi";
import { ApiError } from "@/lib/apiClient";
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

  useEffect(() => {
    let cancelado = false;
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
  }, [ordemServicoId]);

  if (erro) return <p className="text-sm text-destructive">{erro}</p>;
  if (!eventos) return <p className="text-sm text-muted-foreground">Carregando...</p>;
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
