import { useEffect, useState } from "react";
import { EMOJIS_REACAO, MensagemTipo, type Mensagem } from "@isphub/shared";
import { Avatar } from "@/components/Avatar";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { chatApi } from "@/lib/chatApi";
import { ordensServicoApi } from "@/lib/filaApi";
import type { OrdemServico } from "@isphub/shared";
import { copiarTexto } from "@/lib/clipboard";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Reply, Copy, Trash2, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";


function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Bolha "card de OS" — busca a OS sob demanda (a mensagem so guarda o id) e leva pro Painel com busca preenchida. */
function OsRefCard({ ordemServicoId }: { ordemServicoId: string }) {
  const [os, setOs] = useState<OrdemServico | null | "erro">(null);
  const navigate = useNavigate();

  useEffect(() => {
    let vivo = true;
    ordensServicoApi
      .obter(ordemServicoId)
      .then((r) => vivo && setOs(r))
      .catch(() => vivo && setOs("erro"));
    return () => {
      vivo = false;
    };
  }, [ordemServicoId]);

  if (os === null) return <Skeleton className="h-20 w-56 rounded-lg" />;
  if (os === "erro")
    return <p className="text-xs text-muted-foreground">OS não encontrada.</p>;

  return (
    <button
      type="button"
      onClick={() => navigate(`/?q=${encodeURIComponent(os.sgpOsId)}`)}
      className="flex w-56 flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-secondary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-foreground">
          OS #{os.sgpOsId}
        </span>
        <StatusBadge status={os.status} />
      </div>
      {os.clienteNome && (
        <p className="truncate text-sm font-medium text-foreground">
          {os.clienteNome}
        </p>
      )}
      {os.endereco?.logradouro && (
        <p className="truncate text-xs text-muted-foreground">
          {os.endereco.logradouro}
          {os.endereco.bairro ? ` — ${os.endereco.bairro}` : ""}
        </p>
      )}
      <span className="mt-0.5 text-xs font-medium text-primary">
        Abrir OS →
      </span>
    </button>
  );
}

/** Foto/audio sao servidos autenticados (Bearer) — nunca dá pra usar <img src> direto, por isso busca-e-vira-blob. */
function AnexoMidia({
  mensagemId,
  tipo,
  duracaoSeg,
}: {
  mensagemId: string;
  tipo: MensagemTipo;
  duracaoSeg?: number | null;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    chatApi
      .getAnexoBlob(mensagemId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mensagemId]);

  if (tipo === MensagemTipo.FOTO) {
    return url ? (
      <img
        src={url}
        alt="Foto enviada no chat"
        className="max-h-64 w-auto rounded-md object-cover"
      />
    ) : (
      <Skeleton className="h-40 w-48 rounded-md" />
    );
  }
  if (tipo === MensagemTipo.AUDIO) {
    return url ? (
      <div className="flex items-center gap-1.5">
        <audio controls src={url} className="h-10 w-48" />
        {!!duracaoSeg && (
          <span className="font-mono text-[0.65rem] text-muted-foreground">
            {Math.floor(duracaoSeg / 60)}:
            {String(duracaoSeg % 60).padStart(2, "0")}
          </span>
        )}
      </div>
    ) : (
      <Skeleton className="h-10 w-56 rounded-full" />
    );
  }
  return null;
}

export function MessageBubble({
  mensagem,
  souEu,
  mostrarAvatar,
  podeApagar,
  onReagir,
  onResponder,
  onApagar,
}: {
  mensagem: Mensagem;
  souEu: boolean;
  mostrarAvatar: boolean;
  podeApagar: boolean;
  onReagir: (emoji: string) => void;
  onResponder: () => void;
  onApagar: () => void;
}) {
  const { toast } = useToast();
  const [menuAberto, setMenuAberto] = useState(false);
  const apagada = !!mensagem.apagadoEm;
  const sistema = mensagem.tipo === MensagemTipo.SISTEMA;

  if (sistema) {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">
          {mensagem.corpo}
        </span>
      </div>
    );
  }

  async function handleCopiar() {
    if (!mensagem.corpo) return;
    const ok = await copiarTexto(mensagem.corpo);
    toast({
      titulo: ok ? "Copiado" : "Não foi possível copiar",
      variante: ok ? "sucesso" : "erro",
    });
    setMenuAberto(false);
  }

  return (
    <div
      className={cn("group flex items-end gap-2", souEu && "flex-row-reverse")}
    >
      <div className="w-7 shrink-0">
        {!souEu && mostrarAvatar && mensagem.autor && (
          <Avatar nome={mensagem.autor.nome} size="sm" />
        )}
      </div>

      <div
        className={cn("flex max-w-[75%] flex-col gap-1", souEu && "items-end")}
      >
        {!souEu && mostrarAvatar && mensagem.autor && (
          <span className="px-1 text-xs font-medium text-muted-foreground">
            {mensagem.autor.nome}
          </span>
        )}

        <div
          className={cn(
            "relative rounded-2xl px-3 py-2 text-sm shadow-soft-sm",
            souEu
              ? "rounded-br-md bg-accent-yellow text-accent-yellow-foreground"
              : "rounded-bl-md bg-secondary text-secondary-foreground",
            apagada && "italic opacity-70",
          )}
        >
          {mensagem.respondendoA && !apagada && (
            <div
              className={cn(
                "mb-1.5 rounded-md border-l-2 px-2 py-1 text-xs opacity-80",
                souEu
                  ? "border-accent-yellow-foreground/40"
                  : "border-primary/40",
              )}
            >
              <p className="font-medium">
                {mensagem.respondendoA.autorNome ?? "Mensagem"}
              </p>
              <p className="truncate">{mensagem.respondendoA.resumo}</p>
            </div>
          )}

          {apagada ? (
            <p>Mensagem apagada</p>
          ) : mensagem.tipo === MensagemTipo.OS_REF &&
            mensagem.ordemServicoId ? (
            <OsRefCard ordemServicoId={mensagem.ordemServicoId} />
          ) : mensagem.tipo === MensagemTipo.FOTO ||
            mensagem.tipo === MensagemTipo.AUDIO ? (
            <div className="flex flex-col gap-1.5">
              <AnexoMidia
                mensagemId={mensagem.id}
                tipo={mensagem.tipo}
                duracaoSeg={mensagem.duracaoSeg}
              />
              {mensagem.corpo && (
                <p className="whitespace-pre-wrap break-words">
                  {mensagem.corpo}
                </p>
              )}
            </div>
          ) : mensagem.tipo === MensagemTipo.LOCALIZACAO &&
            mensagem.lat != null &&
            mensagem.lng != null ? (
            <a
              href={`https://www.google.com/maps?q=${mensagem.lat},${mensagem.lng}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 underline underline-offset-2"
            >
              <MapPin className="size-4 shrink-0" />
              Localização compartilhada
            </a>
          ) : (
            <p className="whitespace-pre-wrap break-words">{mensagem.corpo}</p>
          )}

          {!apagada && mensagem.tipo === MensagemTipo.TEXTO && mensagem.autor?.assinaturaChat && (
            <p className="mt-1 text-xs italic opacity-70">{mensagem.autor.assinaturaChat}</p>
          )}

          <div
            className={cn(
              "mt-1 flex items-center gap-1 text-[0.65rem] font-mono opacity-70",
              souEu && "justify-end",
            )}
          >
            {formatHora(mensagem.criadoEm)}
            {mensagem.editadoEm && !apagada && <span>· editado</span>}
          </div>
        </div>

        {mensagem.reacoes.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {mensagem.reacoes.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReagir(r.emoji)}
                className="rounded-full border border-border bg-card px-1.5 py-0.5 text-xs shadow-soft-sm transition-colors hover:bg-secondary"
              >
                {r.emoji} {r.usuarioIds.length}
              </button>
            ))}
          </div>
        )}
      </div>

      {!apagada && (
        <Popover open={menuAberto} onOpenChange={setMenuAberto}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Opções da mensagem"
              className="rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-1.5"
            align={souEu ? "end" : "start"}
          >
            <div className="flex gap-0.5 border-b border-border px-1 pb-1.5">
              {EMOJIS_REACAO.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onReagir(emoji);
                    setMenuAberto(false);
                  }}
                  className="rounded-md p-1 text-base transition-colors hover:bg-secondary"
                  aria-label={`Reagir com ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                onResponder();
                setMenuAberto(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <Reply className="size-4 text-muted-foreground" />
              Responder
            </button>
            {mensagem.corpo && (
              <button
                type="button"
                onClick={handleCopiar}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <Copy className="size-4 text-muted-foreground" />
                Copiar
              </button>
            )}
            {podeApagar && (
              <button
                type="button"
                onClick={() => {
                  onApagar();
                  setMenuAberto(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="size-4" />
                Apagar
              </button>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
