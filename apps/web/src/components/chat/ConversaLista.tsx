import {
  ConversaTipo,
  MensagemTipo,
  type ConversaResumo,
} from "@isphub/shared";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { Megaphone, SquarePen, Users } from "lucide-react";

const ROTULO_TIPO: Partial<Record<MensagemTipo, string>> = {
  [MensagemTipo.FOTO]: "📷 Foto",
  [MensagemTipo.AUDIO]: "🎤 Áudio",
  [MensagemTipo.LOCALIZACAO]: "📍 Localização",
  [MensagemTipo.OS_REF]: "📋 Ordem de serviço",
};

/** "Você:" na frente quando a ultima mensagem foi minha — comparado por nome (autorNome e a unica pista que MensagemResumo carrega). */
function previewMensagem(conversa: ConversaResumo, meuNome: string): string {
  const u = conversa.ultimaMensagem;
  if (!u) return "Nenhuma mensagem ainda";
  if (u.apagadoEm) return "Mensagem apagada";
  const prefixo = u.autorNome === meuNome ? "Você: " : "";
  const texto = u.corpo ?? ROTULO_TIPO[u.tipo] ?? "";
  return `${prefixo}${texto}`;
}

function formatHora(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  if (data.toDateString() === hoje.toDateString()) {
    return data.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function IconeConversa({ tipo }: { tipo: ConversaTipo }) {
  if (tipo === ConversaTipo.AVISOS) return <Megaphone className="size-4" />;
  if (tipo === ConversaTipo.GRUPO) return <Users className="size-4" />;
  return null;
}

export function ConversaLista({
  conversas,
  carregando,
  erro,
  onRetry,
  conversaSelecionadaId,
  onSelecionar,
  onNovaConversa,
  meuId,
  meuNome,
}: {
  conversas: ConversaResumo[];
  carregando: boolean;
  erro: boolean;
  onRetry: () => void;
  conversaSelecionadaId: string | null;
  onSelecionar: (c: ConversaResumo) => void;
  onNovaConversa: () => void;
  meuId: string;
  meuNome: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h1 className="font-display text-lg font-bold text-foreground">Chat</h1>
        <Button
          variant="ghost"
          size="icon"
          title="Nova conversa"
          aria-label="Nova conversa"
          onClick={onNovaConversa}
        >
          <SquarePen />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {carregando ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : erro ? (
          <ErrorState
            className="m-3"
            onRetry={onRetry}
            message="Não foi possível carregar as conversas."
          />
        ) : conversas.length === 0 ? (
          <EmptyState
            className="m-3"
            title="Nenhuma conversa ainda"
            description="Toque no lápis para começar."
          />
        ) : (
          conversas.map((c) => {
            const outro =
              c.tipo === ConversaTipo.DIRETA
                ? c.participantes.find((p) => p.usuarioId !== meuId)
                : undefined;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelecionar(c)}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-secondary/60",
                  conversaSelecionadaId === c.id && "bg-secondary",
                )}
              >
                <Avatar
                  nome={c.titulo}
                  online={
                    c.tipo === ConversaTipo.DIRETA ? outro?.online : undefined
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-foreground">
                      <IconeConversa tipo={c.tipo} />
                      {c.tipo === ConversaTipo.OS && c.sgpOsId
                        ? `OS #${c.sgpOsId}`
                        : c.titulo}
                    </span>
                    {c.ultimaMensagem && (
                      <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                        {formatHora(c.ultimaMensagem.criadoEm)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-xs",
                        c.naoLidas > 0
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {previewMensagem(c, meuNome)}
                    </span>
                    {c.naoLidas > 0 && (
                      <span className="flex min-w-4 shrink-0 items-center justify-center rounded-full bg-accent-yellow px-1.5 text-[0.65rem] font-bold leading-4 text-accent-yellow-foreground">
                        {c.naoLidas > 9 ? "9+" : c.naoLidas}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
