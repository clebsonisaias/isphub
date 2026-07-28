import { useEffect, useRef, useState } from "react";
import {
  ConversaTipo,
  UserRole,
  type ConversaResumo,
  type Mensagem,
} from "@isphub/shared";
import { Avatar } from "@/components/Avatar";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { Composer } from "@/components/chat/Composer";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useRealtime } from "@/lib/realtime";
import { chatApi, type RespostaRapidaTipo } from "@/lib/chatApi";
import { ApiError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowDown } from "lucide-react";

const RESPOSTAS_RAPIDAS: { tipo: RespostaRapidaTipo; label: string }[] = [
  { tipo: "a_caminho", label: "A caminho" },
  { tipo: "cheguei", label: "Cheguei" },
  { tipo: "cliente_ausente", label: "Cliente ausente" },
  { tipo: "preciso_apoio", label: "Preciso de apoio" },
];

const LIMIAR_NO_FIM_PX = 80;

function mensagemErro(err: unknown): string {
  return err instanceof ApiError
    ? err.message
    : "Falha ao comunicar com o servidor";
}

function rotuloDia(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const mesmodia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mesmodia(data, hoje)) return "Hoje";
  if (mesmodia(data, ontem)) return "Ontem";
  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function tituloPresenca(conversa: ConversaResumo, meuId: string): string {
  if (conversa.tipo !== ConversaTipo.DIRETA) {
    return `${conversa.participantes.length} participantes`;
  }
  const outro = conversa.participantes.find((p) => p.usuarioId !== meuId);
  if (!outro) return "";
  if (outro.online) return "Online";
  if (!outro.ultimaAtividadeEm) return "Offline";
  const min = Math.round(
    (Date.now() - new Date(outro.ultimaAtividadeEm).getTime()) / 60_000,
  );
  if (min < 1) return "Visto agora";
  if (min < 60) return `Visto há ${min}min`;
  const h = Math.round(min / 60);
  return `Visto há ${h}h`;
}

/** Thread central: cabecalho + mensagens (agrupadas por autor/dia) + composer. Uma conversa por vez. */
export function ChatThread({
  conversa,
  onVoltar,
  onConversaAtualizada,
}: {
  conversa: ConversaResumo;
  onVoltar?: () => void;
  onConversaAtualizada: () => void;
}) {
  const { usuario } = useAuth();
  const { toast } = useToast();
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);
  const [erro, setErro] = useState(false);
  const [respondendoA, setRespondendoA] = useState<{
    id: string;
    autorNome: string | null;
    resumo: string;
  } | null>(null);
  const [novasAbaixo, setNovasAbaixo] = useState(false);
  const [digitandoNome, setDigitandoNome] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const digitandoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const meuId = usuario!.id;
  const souTecnico = usuario!.role === UserRole.TECNICO;
  const ehAdmin = usuario!.role === UserRole.ADMIN;
  const ehAvisos = conversa.tipo === ConversaTipo.AVISOS;
  const podeEnviar = !ehAvisos || ehAdmin || usuario!.role === UserRole.GESTOR;

  function estaNoFim(): boolean {
    const el = listaRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < LIMIAR_NO_FIM_PX;
  }

  function scrollParaFim(smooth = false) {
    const el = listaRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  async function carregar() {
    setErro(false);
    try {
      const resp = await chatApi.mensagens(conversa.id);
      setMensagens([...resp].reverse());
      setTimeout(() => scrollParaFim(false), 0);
      await chatApi.marcarLida(conversa.id);
      onConversaAtualizada();
    } catch {
      setErro(true);
    }
  }

  useEffect(() => {
    setMensagens(null);
    setRespondendoA(null);
    setNovasAbaixo(false);
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversa.id]);

  useRealtime((evento) => {
    if (evento.conversaId !== conversa.id) return;
    if (evento.tipo === "chat-digitando" && evento.autorId !== meuId) {
      const p = conversa.participantes.find(
        (x) => x.usuarioId === evento.autorId,
      );
      setDigitandoNome(p?.nome ?? "Alguém");
      if (digitandoTimeoutRef.current)
        clearTimeout(digitandoTimeoutRef.current);
      digitandoTimeoutRef.current = setTimeout(
        () => setDigitandoNome(null),
        4000,
      );
      return;
    }
    if (evento.tipo !== "chat-mensagem") return;
    const jaNoFim = estaNoFim();
    chatApi
      .mensagens(conversa.id)
      .then((resp) => {
        setMensagens([...resp].reverse());
        onConversaAtualizada();
        if (evento.autorId === meuId || jaNoFim) {
          setTimeout(() => scrollParaFim(true), 0);
          void chatApi.marcarLida(conversa.id);
        } else {
          setNovasAbaixo(true);
        }
      })
      .catch(() => {});
  });

  async function handleEnviar(input: Parameters<typeof chatApi.enviar>[1]) {
    await chatApi.enviar(conversa.id, input);
    await carregar();
    scrollParaFim(true);
  }

  async function handleReagir(mensagemId: string, emoji: string) {
    try {
      await chatApi.reagir(conversa.id, mensagemId, emoji);
      await carregar();
    } catch (err) {
      toast({
        titulo: "Não foi possível reagir",
        descricao: mensagemErro(err),
        variante: "erro",
      });
    }
  }

  async function handleApagar(mensagemId: string) {
    try {
      await chatApi.apagar(conversa.id, mensagemId);
      await carregar();
    } catch (err) {
      toast({
        titulo: "Não foi possível apagar",
        descricao: mensagemErro(err),
        variante: "erro",
      });
    }
  }

  async function handleRespostaRapida(tipo: RespostaRapidaTipo) {
    try {
      await chatApi.respostaRapida(conversa.id, tipo);
      await carregar();
    } catch (err) {
      toast({
        titulo: "Não foi possível registrar",
        descricao: mensagemErro(err),
        variante: "erro",
      });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
        {onVoltar && (
          <button
            type="button"
            onClick={onVoltar}
            className="rounded-full p-1.5 hover:bg-secondary lg:hidden"
            aria-label="Voltar"
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
        {conversa.tipo === ConversaTipo.DIRETA ? (
          <Avatar
            nome={conversa.titulo}
            online={
              conversa.participantes.find((p) => p.usuarioId !== meuId)?.online
            }
          />
        ) : (
          <Avatar nome={conversa.titulo} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {conversa.tipo === ConversaTipo.OS && conversa.sgpOsId
              ? `OS #${conversa.sgpOsId}`
              : conversa.titulo}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {digitandoNome
              ? `${digitandoNome} está digitando…`
              : tituloPresenca(conversa, meuId)}
          </p>
        </div>
      </div>

      <div ref={listaRef} className="relative flex-1 overflow-y-auto px-3 py-3">
        {mensagens === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton
                key={i}
                className={cn(
                  "h-12 rounded-2xl",
                  i % 2 === 0 ? "w-2/3" : "ml-auto w-1/2",
                )}
              />
            ))}
          </div>
        ) : erro ? (
          <ErrorState
            message="Não foi possível carregar as mensagens."
            onRetry={carregar}
          />
        ) : mensagens.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma mensagem ainda. Diga oi!
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {mensagens.map((m, i) => {
              const anterior = mensagens[i - 1];
              const novoDia =
                !anterior ||
                rotuloDia(anterior.criadoEm) !== rotuloDia(m.criadoEm);
              const mostrarAvatar =
                !anterior ||
                anterior.autor?.usuarioId !== m.autor?.usuarioId ||
                novoDia;
              const souEu = m.autor?.usuarioId === meuId;
              const podeApagar = souEu || ehAdmin;
              return (
                <div key={m.id}>
                  {novoDia && (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">
                        {rotuloDia(m.criadoEm)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    mensagem={m}
                    souEu={souEu}
                    mostrarAvatar={mostrarAvatar}
                    podeApagar={podeApagar}
                    onReagir={(emoji) => handleReagir(m.id, emoji)}
                    onResponder={() =>
                      setRespondendoA({
                        id: m.id,
                        autorNome: m.autor?.nome ?? null,
                        resumo: m.corpo ?? "Mensagem",
                      })
                    }
                    onApagar={() => handleApagar(m.id)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {novasAbaixo && (
          <button
            type="button"
            onClick={() => {
              scrollParaFim(true);
              setNovasAbaixo(false);
              void chatApi.marcarLida(conversa.id);
            }}
            className="sticky bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-soft-lg"
          >
            <ArrowDown className="size-3.5" />
            Novas mensagens
          </button>
        )}
      </div>

      {conversa.tipo === ConversaTipo.OS && souTecnico && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
          {RESPOSTAS_RAPIDAS.map((r) => (
            <button
              key={r.tipo}
              type="button"
              onClick={() => handleRespostaRapida(r.tipo)}
              className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      <Composer
        respondendoA={respondendoA}
        onCancelarResposta={() => setRespondendoA(null)}
        onEnviar={handleEnviar}
        onDigitando={() => void chatApi.digitando(conversa.id)}
        podeEnviar={podeEnviar}
        motivoBloqueio="Só admin/gestor pode postar no canal de Avisos."
      />
    </div>
  );
}
