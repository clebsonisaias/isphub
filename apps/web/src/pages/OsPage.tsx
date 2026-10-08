import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { FilaItem } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { OrdemServicoDetalhe } from "@/components/OrdemServicoDetalhe";
import { ordensServicoApi } from "@/lib/filaApi";
import { ApiError } from "@/lib/apiClient";
import { ArrowLeft } from "lucide-react";

/**
 * Uma OS com URL propria. O corpo e o mesmo do dialogo da fila; o que muda e
 * que isto se compartilha (cola no chat, abre em outra aba, volta pelo
 * historico). `GET /ordens-servico/:id` devolve a forma da fila (FilaItem).
 */
export function OsPage() {
  const { id = "" } = useParams();
  const [os, setOs] = useState<FilaItem | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setOs(await ordensServicoApi.obter(id));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Falha ao comunicar com o servidor");
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <AppShell>
      <AnimatedPage>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />
            Painel
          </Link>
          {erro ? (
            <ErrorState message={erro} onRetry={() => void carregar()} />
          ) : os ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-soft-sm sm:p-6">
              {/* As acoes ja atualizam o eco local dentro do detalhe; nada a re-buscar aqui. */}
              <OrdemServicoDetalhe key={os.id} item={os} onMudanca={() => {}} />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
        </div>
      </AnimatedPage>
    </AppShell>
  );
}
