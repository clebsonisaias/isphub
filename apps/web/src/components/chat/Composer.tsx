import { useEffect, useRef, useState } from "react";
import { MensagemTipo } from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { comprimirImagem } from "@/lib/imagem";
import { useToast } from "@/context/ToastContext";
import { ApiError } from "@/lib/apiClient";
import type { EnviarMensagemInput } from "@/lib/chatApi";
import { Send, Paperclip, MapPin, Mic, Square, X } from "lucide-react";

const MAX_LINHAS = 5;
const LIMITE_AUDIO_SEG = 60;

function mensagemErro(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao enviar";
}

/** MIME suportado pelo servidor (chatService.MIMES_AUDIO) — o browser escolhe o primeiro que souber gravar. */
function mimeAudioSuportado(): string {
  for (const mime of ["audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "audio/webm";
}

function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const resultado = reader.result as string;
      resolve(resultado.slice(resultado.indexOf(",") + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function Composer({
  respondendoA,
  onCancelarResposta,
  onEnviar,
  onDigitando,
  podeEnviar,
  motivoBloqueio,
}: {
  respondendoA: { id: string; autorNome: string | null; resumo: string } | null;
  onCancelarResposta: () => void;
  onEnviar: (input: EnviarMensagemInput) => Promise<void>;
  onDigitando: () => void;
  podeEnviar: boolean;
  motivoBloqueio?: string;
}) {
  const { toast } = useToast();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundosGravados, setSegundosGravados] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const canceladoRef = useRef(false);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const linhaPx = 20;
    el.style.height = `${Math.min(el.scrollHeight, linhaPx * MAX_LINHAS)}px`;
  }, [texto]);

  async function enviarComInput(input: EnviarMensagemInput) {
    setEnviando(true);
    try {
      await onEnviar(input);
      onCancelarResposta();
    } catch (err) {
      toast({
        titulo: "Não foi possível enviar",
        descricao: mensagemErro(err),
        variante: "erro",
      });
    } finally {
      setEnviando(false);
    }
  }

  async function handleEnviarTexto() {
    const corpo = texto.trim();
    if (!corpo || enviando) return;
    setTexto("");
    await enviarComInput({
      tipo: MensagemTipo.TEXTO,
      corpo,
      respondendoAId: respondendoA?.id,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleEnviarTexto();
    }
  }

  async function handleAnexarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    try {
      const { dados, mimeType } = await comprimirImagem(arquivo);
      await enviarComInput({
        tipo: MensagemTipo.FOTO,
        anexoBase64: dados,
        anexoMime: mimeType,
        respondendoAId: respondendoA?.id,
      });
    } catch (err) {
      toast({
        titulo: "Não foi possível processar a foto",
        descricao: mensagemErro(err),
        variante: "erro",
      });
    }
  }

  function handleCompartilharLocalizacao() {
    if (!navigator.geolocation) {
      toast({
        titulo: "Geolocalização indisponível neste navegador",
        variante: "erro",
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void enviarComInput({
          tipo: MensagemTipo.LOCALIZACAO,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          respondendoAId: respondendoA?.id,
        });
      },
      () =>
        toast({
          titulo: "Não foi possível obter sua localização",
          variante: "erro",
        }),
    );
  }

  async function iniciarGravacao() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = mimeAudioSuportado();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      canceladoRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (intervaloRef.current) clearInterval(intervaloRef.current);
        setGravando(false);
        if (canceladoRef.current || chunksRef.current.length === 0) {
          setSegundosGravados(0);
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mime });
        const duracao = segundosGravados;
        setSegundosGravados(0);
        void blobParaBase64(blob).then((base64) =>
          enviarComInput({
            tipo: MensagemTipo.AUDIO,
            anexoBase64: base64,
            anexoMime: mime,
            duracaoSeg: duracao,
            respondendoAId: respondendoA?.id,
          }),
        );
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setGravando(true);
      setSegundosGravados(0);
      intervaloRef.current = setInterval(() => {
        setSegundosGravados((s) => {
          if (s + 1 >= LIMITE_AUDIO_SEG) {
            mediaRecorderRef.current?.stop();
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      toast({
        titulo: "Não foi possível acessar o microfone",
        variante: "erro",
      });
    }
  }

  function pararGravacao(cancelar: boolean) {
    canceladoRef.current = cancelar;
    mediaRecorderRef.current?.stop();
  }

  if (!podeEnviar) {
    return (
      <div className="border-t border-border bg-secondary/30 px-4 py-3 text-center text-sm text-muted-foreground">
        {motivoBloqueio ?? "Você não pode enviar mensagens nesta conversa."}
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-card">
      {respondendoA && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-1.5">
          <div className="min-w-0 border-l-2 border-primary/50 pl-2">
            <p className="truncate text-xs font-medium text-foreground">
              {respondendoA.autorNome ?? "Mensagem"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {respondendoA.resumo}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelarResposta}
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Cancelar resposta"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-1.5 p-2.5">
        {gravando ? (
          <div className="flex flex-1 items-center gap-2 rounded-full bg-destructive/10 px-3 py-2 text-destructive">
            <span
              className="size-2 animate-pulse rounded-full bg-destructive"
              aria-hidden
            />
            <span className="font-mono text-sm tabular-nums">
              {String(Math.floor(segundosGravados / 60)).padStart(2, "0")}:
              {String(segundosGravados % 60).padStart(2, "0")}
            </span>
            <span className="text-xs text-muted-foreground">
              Gravando áudio…
            </span>
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAnexarFoto}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Anexar foto"
              aria-label="Anexar foto"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Compartilhar localização"
              aria-label="Compartilhar localização"
              onClick={handleCompartilharLocalizacao}
            >
              <MapPin />
            </Button>
            <textarea
              ref={textareaRef}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                onDigitando();
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Escreva uma mensagem…"
              className="max-h-[7.5rem] flex-1 resize-none rounded-2xl border border-border bg-background px-3.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </>
        )}

        {gravando ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Cancelar"
              aria-label="Cancelar gravação"
              onClick={() => pararGravacao(true)}
            >
              <X />
            </Button>
            <Button
              type="button"
              variant="brand"
              size="icon"
              title="Enviar áudio"
              aria-label="Enviar áudio"
              onClick={() => pararGravacao(false)}
            >
              <Square className="size-3.5" />
            </Button>
          </>
        ) : texto.trim() ? (
          <Button
            type="button"
            variant="brand"
            size="icon"
            disabled={enviando}
            onClick={handleEnviarTexto}
            aria-label="Enviar mensagem"
          >
            <Send />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Segure para gravar"
            aria-label="Gravar áudio"
            onMouseDown={iniciarGravacao}
            onTouchStart={iniciarGravacao}
          >
            <Mic />
          </Button>
        )}
      </div>
    </div>
  );
}
