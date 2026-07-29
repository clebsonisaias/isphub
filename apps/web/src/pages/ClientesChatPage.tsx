import { useEffect, useState } from "react";
import { CANAL_WHATSAPP_LABEL, type ConversaClienteResumo, type MensagemClienteDTO } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/context/AuthContext";
import { useRealtime } from "@/lib/realtime";
import { clientesChatApi } from "@/lib/clientesChatApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

function ConversaListItem({ conversa, ativa, onClick }: { conversa: ConversaClienteResumo; ativa: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-secondary/50",
        ativa && "bg-secondary/70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{conversa.nomeContato ?? conversa.telefone}</span>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] text-primary">{CANAL_WHATSAPP_LABEL[conversa.canal]}</span>
      </div>
      <span className="truncate text-xs text-muted-foreground">{conversa.ultimaMensagem?.corpo ?? "Sem mensagens"}</span>
      {conversa.agenteNome && <span className="text-[0.65rem] text-muted-foreground">Com {conversa.agenteNome}</span>}
    </button>
  );
}

/** Duas colunas (lista | thread) — mesma ideia estrutural de ChatPage.tsx, simplificado (sem reacoes/replies/midia no v1 web). */
export function ClientesChatPage() {
  const { usuario } = useAuth();
  const { toast } = useToast();
  const [filtro, setFiltro] = useState<"fila" | "minhas">("fila");
  const [conversas, setConversas] = useState<ConversaClienteResumo[] | null>(null);
  const [selecionada, setSelecionada] = useState<ConversaClienteResumo | null>(null);
  const [mensagens, setMensagens] = useState<MensagemClienteDTO[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function carregarConversas() {
    try {
      setConversas(await clientesChatApi.conversas(filtro));
    } catch (err) {
      toast({ titulo: "Erro ao carregar conversas", descricao: mensagem(err), variante: "erro" });
    }
  }

  async function carregarMensagens(conversaId: string) {
    try {
      setMensagens(await clientesChatApi.mensagens(conversaId));
    } catch (err) {
      toast({ titulo: "Erro ao carregar mensagens", descricao: mensagem(err), variante: "erro" });
    }
  }

  useEffect(() => {
    setConversas(null);
    void carregarConversas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  useEffect(() => {
    if (selecionada) void carregarMensagens(selecionada.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionada?.id]);

  useRealtime((evento) => {
    if (evento.tipo === "cliente-chat-conversa" || evento.tipo === "cliente-chat-mensagem") {
      void carregarConversas();
      if (selecionada && evento.conversaId === selecionada.id) void carregarMensagens(selecionada.id);
    }
  });

  async function handleEnviar() {
    if (!selecionada || !texto.trim()) return;
    setEnviando(true);
    try {
      await clientesChatApi.enviar(selecionada.id, texto.trim());
      setTexto("");
      await carregarMensagens(selecionada.id);
    } catch (err) {
      toast({ titulo: "Erro ao enviar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

  async function handleAssumir() {
    if (!selecionada) return;
    try {
      await clientesChatApi.assumir(selecionada.id);
      await carregarConversas();
      setSelecionada((prev) => (prev ? { ...prev, agenteId: usuario!.id, agenteNome: usuario!.nome } : prev));
    } catch (err) {
      toast({ titulo: "Não foi possível assumir", descricao: mensagem(err), variante: "erro" });
    }
  }

  async function handleEncerrar() {
    if (!selecionada) return;
    try {
      await clientesChatApi.encerrar(selecionada.id);
      setSelecionada(null);
      await carregarConversas();
    } catch (err) {
      toast({ titulo: "Não foi possível encerrar", descricao: mensagem(err), variante: "erro" });
    }
  }

  const jaAssumida = !!selecionada?.agenteId;
  const souEuQueAssumi = selecionada?.agenteId === usuario?.id;

  return (
    <AppShell>
      <div className="-mx-4 -my-6 flex h-[calc(100svh-3.5rem-6rem)] overflow-hidden rounded-none border-y border-border bg-card lg:mx-0 lg:my-0 lg:h-[calc(100svh-3.5rem-3rem)] lg:rounded-xl lg:border">
        <div className={cn("w-full shrink-0 border-r border-border lg:w-80", selecionada && "hidden lg:block")}>
          <div className="flex gap-1 border-b border-border p-2">
            <Button variant={filtro === "fila" ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setFiltro("fila")}>
              Fila
            </Button>
            <Button variant={filtro === "minhas" ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setFiltro("minhas")}>
              Minhas
            </Button>
          </div>
          <div className="overflow-y-auto">
            {conversas === null ? (
              <p className="p-4 text-sm text-muted-foreground">Carregando...</p>
            ) : conversas.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{filtro === "fila" ? "Fila vazia." : "Nenhuma conversa sua ainda."}</p>
            ) : (
              conversas.map((c) => (
                <ConversaListItem key={c.id} conversa={c} ativa={selecionada?.id === c.id} onClick={() => setSelecionada(c)} />
              ))
            )}
          </div>
        </div>

        <div className={cn("flex min-w-0 flex-1 flex-col", !selecionada && "hidden lg:flex")}>
          {selecionada ? (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{selecionada.nomeContato ?? selecionada.telefone}</p>
                  <p className="text-xs text-muted-foreground">{CANAL_WHATSAPP_LABEL[selecionada.canal]}</p>
                </div>
                {jaAssumida ? (
                  <Button variant="outline" size="sm" onClick={handleEncerrar}>
                    Encerrar
                  </Button>
                ) : (
                  <Button variant="brand" size="sm" onClick={handleAssumir}>
                    Assumir
                  </Button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {(mensagens ?? []).map((m) => (
                  <div key={m.id} className={cn("mb-2 flex", m.direcao === "saida" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[70%] rounded-lg px-3 py-2 text-sm",
                        m.direcao === "saida" ? "bg-primary text-primary-foreground" : "border border-border bg-card",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.corpo}</p>
                      {m.falhaEnvio && <p className="mt-1 text-xs text-destructive">Falha ao enviar: {m.falhaEnvio}</p>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 border-t border-border p-3">
                <Input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleEnviar()}
                  placeholder={souEuQueAssumi || !jaAssumida ? "Mensagem..." : "Assuma a conversa para responder"}
                  disabled={!(souEuQueAssumi || !jaAssumida)}
                />
                <Button variant="brand" onClick={handleEnviar} disabled={enviando || !texto.trim()}>
                  Enviar
                </Button>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Selecione uma conversa para começar.</div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
