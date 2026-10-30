import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { EvidenciaResumo } from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { ordensServicoApi } from "@/lib/filaApi";
import { api, ApiError } from "@/lib/apiClient";
import { comprimirImagem } from "@/lib/imagem";
import { useToast } from "@/context/ToastContext";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Camera, ImageOff, Clock } from "lucide-react";
import { offlineStorage, type OfflineBlobItem } from "@/lib/offlineStorage";
import { syncEngine } from "@/lib/syncEngine";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

function OfflineThumbnail({ blobItem }: { blobItem: OfflineBlobItem }) {
  const url = `data:${blobItem.imagem.mimeType};base64,${blobItem.imagem.dados}`;
  return (
    <div
      className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-amber-500/50 bg-secondary/30"
      title="Foto salva no aparelho (aguardando sinal para enviar)"
    >
      <img src={url} alt="Foto offline" className="size-full object-cover opacity-85" />
      <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded bg-amber-500/90 px-1 py-0.5 text-[9px] font-bold text-white shadow">
        <Clock className="size-2.5" />
        No aparelho
      </span>
    </div>
  );
}

/** Thumbnail de uma foto — busca os bytes autenticados e vira blob: URL (um <img> comum não manda Authorization). */
function Thumbnail({ ordemServicoId, evidencia }: { ordemServicoId: string; evidencia: EvidenciaResumo }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let objectUrl: string | null = null;
    api
      .getBlob(ordensServicoApi.evidencias.urlArquivo(ordemServicoId, evidencia.id))
      .then((blob) => {
        if (cancelado) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelado) setErro(true);
      });
    return () => {
      cancelado = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ordemServicoId, evidencia.id]);

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary/30"
      title={evidencia.descricao ?? undefined}
    >
      {erro ? (
        <ImageOff className="size-5 text-muted-foreground" />
      ) : url ? (
        <img src={url} alt={evidencia.descricao ?? "Evidência"} className="size-full object-cover" />
      ) : (
        <div className="size-full animate-pulse bg-secondary" />
      )}
    </a>
  );
}

/** Galeria de evidências fotográficas de uma OS + botão pra anexar foto nova (comprimida no cliente). */
export function EvidenciaGallery({ ordemServicoId }: { ordemServicoId: string }) {
  const { toast } = useToast();
  const [evidencias, setEvidencias] = useState<EvidenciaResumo[] | null>(null);
  const [offlineBlobs, setOfflineBlobs] = useState<OfflineBlobItem[]>([]);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function carregar() {
    try {
      const servidor = await ordensServicoApi.evidencias.listar(ordemServicoId).catch(() => null);
      if (servidor) setEvidencias(servidor);
    } catch {
      // Offline: mantém o que já tiver
    }
    const locais = await offlineStorage.listarBlobsDaOs(ordemServicoId);
    setOfflineBlobs(locais);
    if (evidencias === null && locais.length > 0) {
      setEvidencias([]);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordemServicoId]);

  async function handleArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setEnviando(true);
    try {
      const imagem = await comprimirImagem(arquivo);
      if (navigator.onLine) {
        try {
          await ordensServicoApi.evidencias.adicionar(ordemServicoId, imagem);
          toast({ titulo: "Foto adicionada", variante: "sucesso" });
          void carregar();
          return;
        } catch (netErr) {
          console.warn("[EvidenciaGallery] Falha online, salvando no aparelho...", netErr);
        }
      }

      // Salva no armazenamento local offline
      const blobId = crypto.randomUUID();
      await offlineStorage.salvarBlob(blobId, ordemServicoId, imagem);
      await offlineStorage.enfileirarMutacao({
        ordemServicoId,
        tipo: "FOTO",
        payload: { fotoIdLocal: blobId },
      });
      void syncEngine.atualizarPendencias();
      toast({
        titulo: "Foto salva no aparelho",
        descricao: "Modo Offline: a foto será enviada quando houver sinal.",
        variante: "info",
      });
      void carregar();
    } catch (err) {
      toast({ titulo: "Erro ao processar foto", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

  const temFotos = (evidencias?.length ?? 0) > 0 || offlineBlobs.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleArquivo}
      />
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => inputRef.current?.click()}
        disabled={enviando}
      >
        <Camera className={enviando ? "animate-pulse" : ""} />
        {enviando ? "Processando..." : "Adicionar foto"}
      </Button>

      {evidencias === null && offlineBlobs.length === 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : !temFotos ? (
        <EmptyState title="Nenhuma foto anexada ainda" className="py-6" />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {offlineBlobs.map((blob) => (
            <OfflineThumbnail key={blob.id} blobItem={blob} />
          ))}
          {evidencias?.map((ev) => (
            <Thumbnail key={ev.id} ordemServicoId={ordemServicoId} evidencia={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
