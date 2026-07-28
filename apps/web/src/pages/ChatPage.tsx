import { useEffect, useState } from "react";
import type { ConversaResumo } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { ConversaLista } from "@/components/chat/ConversaLista";
import { ChatThread } from "@/components/chat/ChatThread";
import { NovaConversaDialog } from "@/components/chat/NovaConversaDialog";
import { useAuth } from "@/context/AuthContext";
import { useRealtime } from "@/lib/realtime";
import { chatApi } from "@/lib/chatApi";
import { cn } from "@/lib/utils";

/**
 * Duas colunas no desktop (lista | thread); uma coluna no mobile, a thread
 * empurra a lista pra fora da tela (mesma ideia do WhatsApp Web x app).
 * Altura fixa descontando header (h-14) + nav de rodape no mobile + padding
 * do <main> — a pagina inteira nao rola, so as colunas internas rolam.
 */
export function ChatPage() {
  const { usuario } = useAuth();
  const [conversas, setConversas] = useState<ConversaResumo[] | null>(null);
  const [erro, setErro] = useState(false);
  const [conversaSelecionada, setConversaSelecionada] =
    useState<ConversaResumo | null>(null);
  const [novaConversaAberta, setNovaConversaAberta] = useState(false);

  async function carregarConversas() {
    try {
      const lista = await chatApi.conversas();
      setConversas(lista);
      setErro(false);
      setConversaSelecionada((atual) =>
        atual ? (lista.find((c) => c.id === atual.id) ?? atual) : atual,
      );
    } catch {
      setErro(true);
    }
  }

  useEffect(() => {
    void chatApi.garantirAvisos().catch(() => {});
    void carregarConversas();
  }, []);

  useRealtime((evento) => {
    if (
      evento.tipo === "chat-mensagem" ||
      evento.tipo === "chat-leitura" ||
      evento.tipo === "chat-conversa"
    ) {
      void carregarConversas();
    }
  });

  function handleSelecionar(c: ConversaResumo) {
    setConversaSelecionada(c);
  }

  function handleConversaCriada(c: ConversaResumo) {
    setConversas((prev) => {
      const semDuplicata = (prev ?? []).filter((x) => x.id !== c.id);
      return [c, ...semDuplicata];
    });
    setConversaSelecionada(c);
  }

  return (
    <AppShell>
      <div className="-mx-4 -my-6 flex h-[calc(100svh-3.5rem-6rem)] overflow-hidden rounded-none border-y border-border bg-card lg:mx-0 lg:my-0 lg:h-[calc(100svh-3.5rem-3rem)] lg:rounded-xl lg:border">
        <div
          className={cn(
            "w-full shrink-0 border-r border-border lg:w-80",
            conversaSelecionada && "hidden lg:block",
          )}
        >
          <ConversaLista
            conversas={conversas ?? []}
            carregando={conversas === null}
            erro={erro}
            onRetry={carregarConversas}
            conversaSelecionadaId={conversaSelecionada?.id ?? null}
            onSelecionar={handleSelecionar}
            onNovaConversa={() => setNovaConversaAberta(true)}
            meuId={usuario!.id}
            meuNome={usuario!.nome}
          />
        </div>

        <div
          className={cn(
            "min-w-0 flex-1",
            !conversaSelecionada && "hidden lg:flex",
          )}
        >
          {conversaSelecionada ? (
            <ChatThread
              key={conversaSelecionada.id}
              conversa={conversaSelecionada}
              onVoltar={() => setConversaSelecionada(null)}
              onConversaAtualizada={carregarConversas}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Selecione uma conversa para começar.
            </div>
          )}
        </div>
      </div>

      <NovaConversaDialog
        open={novaConversaAberta}
        onOpenChange={setNovaConversaAberta}
        onConversaCriada={handleConversaCriada}
      />
    </AppShell>
  );
}
