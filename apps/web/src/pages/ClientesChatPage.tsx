import { useEffect, useState } from "react";
import {
  CANAL_WHATSAPP_LABEL,
  CanalWhatsapp,
  FILTROS_CONVERSA_CLIENTE,
  UserRole,
  type ConversaClienteResumo,
  type FiltroConversaCliente,
  type MensagemClienteDTO,
} from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { MensagemClienteBolha } from "@/components/chat-clientes/MensagemClienteBolha";
import { NovaConversaClienteDialog } from "@/components/chat-clientes/NovaConversaClienteDialog";
import { TransferirConversaDialog } from "@/components/chat-clientes/TransferirConversaDialog";
import { useAuth } from "@/context/AuthContext";
import { useRealtime } from "@/lib/realtime";
import { clientesChatApi } from "@/lib/clientesChatApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { SquarePen } from "lucide-react";

const ROTULO_FILTRO: Record<FiltroConversaCliente, string> = {
  fila: "Fila",
  minhas: "Minhas",
  todas: "Todas",
};

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

function formatHora(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  if (data.toDateString() === hoje.toDateString()) return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function ConversaListItem({ conversa, ativa, onClick }: { conversa: ConversaClienteResumo; ativa: boolean; onClick: () => void }) {
  // Quem responde hoje é o que importa; sem dono, quem disparou o template é a única pista de responsabilidade.
  const rodape = conversa.agenteNome
    ? `Com ${conversa.agenteNome}`
    : conversa.iniciadaPorNome
      ? `Iniciada por ${conversa.iniciadaPorNome}`
      : null;

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
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{conversa.ultimaMensagem?.corpo ?? "Sem mensagens"}</span>
        {conversa.ultimaMensagem && (
          <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">{formatHora(conversa.ultimaMensagem.criadoEm)}</span>
        )}
      </div>
      {rodape && <span className="text-[0.65rem] text-muted-foreground">{rodape}</span>}
    </button>
  );
}

/** Duas colunas (lista | thread) — mesma ideia estrutural de ChatPage.tsx, simplificado (sem reacoes/replies/midia no v1 web). */
export function ClientesChatPage() {
  const { usuario } = useAuth();
  const { toast } = useToast();
  // ADMIN/GESTOR enxergam tudo e intervêm; TECNICO só recebe do servidor as
  // conversas que ele mesmo iniciou — pra ele fila/minhas seriam a mesma lista.
  const podeVerTudo = usuario?.role === UserRole.ADMIN || usuario?.role === UserRole.GESTOR;
  const [filtro, setFiltro] = useState<FiltroConversaCliente>("fila");
  const filtroEfetivo: FiltroConversaCliente = podeVerTudo ? filtro : "todas";
  const [conversas, setConversas] = useState<ConversaClienteResumo[] | null>(null);
  const [selecionada, setSelecionada] = useState<ConversaClienteResumo | null>(null);
  const [mensagens, setMensagens] = useState<MensagemClienteDTO[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [novaAberta, setNovaAberta] = useState(false);
  const [transferirAberta, setTransferirAberta] = useState(false);

  async function carregarConversas() {
    try {
      setConversas(await clientesChatApi.conversas(filtroEfetivo));
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
  }, [filtroEfetivo]);

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

  function handleConversaCriada(conversa: ConversaClienteResumo) {
    setSelecionada(conversa);
    void carregarConversas();
  }

  const jaAssumida = !!selecionada?.agenteId;
  const souEuQueAssumi = selecionada?.agenteId === usuario?.id;
  // Intervenção: ADMIN/GESTOR escrevem em conversa de outro sem tomar a posse dela.
  const intervindo = !!selecionada && podeVerTudo && jaAssumida && !souEuQueAssumi;
  const podeEscrever = !!selecionada && (souEuQueAssumi || !jaAssumida || podeVerTudo);
  // A janela de 24h e regra da API oficial da Meta. No Evolution (nao oficial)
  // ela nao existe — avisar ali seria mentira na tela.
  //
  // So AVISA, nao bloqueia o composer: `dentroJanela24h` e derivado do nosso
  // proprio historico, entao um webhook nao entregue nos faria calcular "fora
  // da janela" pra uma conversa em que o cliente acabou de escrever. Trancar o
  // atendente por engano e pior que deixar enviar — a recusa da Meta ja aparece
  // na bolha via `falhaEnvio`. O mobile segue o mesmo criterio.
  const foraDaJanela = !!selecionada && selecionada.canal === CanalWhatsapp.META && !selecionada.dentroJanela24h;

  return (
    <AppShell>
      <div className="-mx-4 -my-6 flex h-[calc(100svh-3.5rem-6rem)] overflow-hidden rounded-none border-y border-border bg-card lg:mx-0 lg:my-0 lg:h-[calc(100svh-3.5rem-3rem)] lg:rounded-xl lg:border">
        <div className={cn("flex w-full shrink-0 flex-col border-r border-border lg:w-80", selecionada && "hidden lg:flex")}>
          <div className="flex items-center gap-1 border-b border-border p-2">
            {podeVerTudo ? (
              FILTROS_CONVERSA_CLIENTE.map((f) => (
                <Button key={f} variant={filtro === f ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setFiltro(f)}>
                  {ROTULO_FILTRO[f]}
                </Button>
              ))
            ) : (
              <span className="flex-1 px-2 text-sm font-medium text-foreground">Minhas conversas</span>
            )}
            <Button variant="ghost" size="icon" title="Nova conversa" aria-label="Nova conversa" onClick={() => setNovaAberta(true)}>
              <SquarePen />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversas === null ? (
              <p className="p-4 text-sm text-muted-foreground">Carregando...</p>
            ) : conversas.length === 0 ? (
              podeVerTudo ? (
                <p className="p-4 text-sm text-muted-foreground">{filtro === "fila" ? "Fila vazia." : "Nenhuma conversa por aqui ainda."}</p>
              ) : (
                <EmptyState
                  className="m-3"
                  title="Nenhuma conversa ainda"
                  description="Aqui aparecem as conversas que você mesmo iniciar por template. Toque no lápis para começar uma."
                />
              )
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
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{selecionada.nomeContato ?? selecionada.telefone}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {CANAL_WHATSAPP_LABEL[selecionada.canal]}
                    {selecionada.agenteNome ? ` · com ${selecionada.agenteNome}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {podeVerTudo && (
                    <Button variant="outline" size="sm" onClick={() => setTransferirAberta(true)}>
                      Passar para outro atendente
                    </Button>
                  )}
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
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {(mensagens ?? []).map((m) => (
                  <MensagemClienteBolha key={m.id} mensagem={m} />
                ))}
              </div>
              {intervindo && (
                <p className="border-t border-border bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
                  Você está intervindo — a conversa continua com {selecionada.agenteNome}.
                </p>
              )}
              {foraDaJanela && (
                <p className="border-t border-border bg-warning/10 px-4 py-2 text-xs text-warning">
                  Fora da janela de 24h: o WhatsApp só entrega template agora. Texto livre será recusado pela Meta.
                </p>
              )}
              <div className="flex gap-2 border-t border-border p-3">
                <Input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleEnviar()}
                  placeholder={
                    !podeEscrever ? "Assuma a conversa para responder" : intervindo ? `Intervir na conversa de ${selecionada.agenteNome}...` : "Mensagem..."
                  }
                  disabled={!podeEscrever}
                />
                <Button variant="brand" onClick={handleEnviar} disabled={!podeEscrever || enviando || !texto.trim()}>
                  Enviar
                </Button>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Selecione uma conversa para começar.</div>
          )}
        </div>
      </div>

      <NovaConversaClienteDialog open={novaAberta} onOpenChange={setNovaAberta} onConversaCriada={handleConversaCriada} />
      {selecionada && (
        <TransferirConversaDialog
          open={transferirAberta}
          onOpenChange={setTransferirAberta}
          conversaId={selecionada.id}
          agenteAtualId={selecionada.agenteId}
          onTransferida={(agenteId, agenteNome) => {
            setSelecionada((prev) => (prev ? { ...prev, agenteId, agenteNome } : prev));
            void carregarConversas();
          }}
        />
      )}
    </AppShell>
  );
}
