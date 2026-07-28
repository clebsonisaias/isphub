import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { EvidenciaResumo } from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { ordensServicoApi } from "@/lib/filaApi";
import { api, ApiError } from "@/lib/apiClient";
import { comprimirImagem } from "@/lib/imagem";
import { useToast } from "@/context/ToastContext";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Camera, ImageOff } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
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
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function carregar() {
    try {
      setEvidencias(await ordensServicoApi.evidencias.listar(ordemServicoId));
    } catch (err) {
      toast({ titulo: "Erro ao carregar fotos", descricao: mensagem(err), variante: "erro" });
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
      await ordensServicoApi.evidencias.adicionar(ordemServicoId, imagem);
      toast({ titulo: "Foto adicionada", variante: "sucesso" });
      void carregar();
    } catch (err) {
      toast({ titulo: "Erro ao enviar foto", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

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
        {enviando ? "Enviando..." : "Adicionar foto"}
      </Button>

      {evidencias === null ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : evidencias.length === 0 ? (
        <EmptyState title="Nenhuma foto anexada ainda" className="py-6" />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {evidencias.map((ev) => (
            <Thumbnail key={ev.id} ordemServicoId={ordemServicoId} evidencia={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
