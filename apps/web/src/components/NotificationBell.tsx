import { useEffect, useState } from "react";
import type { Notificacao } from "@isphub/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { notificacoesApi } from "@/lib/notificacoesApi";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const INTERVALO_POLLING_MS = 45_000;

/** Sino de notificações no cabeçalho: contador por polling + lista sob demanda ao abrir. */
export function NotificationBell() {
  const [naoLidas, setNaoLidas] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [notificacoes, setNotificacoes] = useState<Notificacao[] | null>(null);

  async function atualizarContagem() {
    try {
      const { naoLidas: n } = await notificacoesApi.contagem();
      setNaoLidas(n);
    } catch {
      // silencioso: o sino nao deve interromper o resto da tela por causa de polling
    }
  }

  useEffect(() => {
    void atualizarContagem();
    const t = setInterval(() => void atualizarContagem(), INTERVALO_POLLING_MS);
    return () => clearInterval(t);
  }, []);

  async function handleOpenChange(v: boolean) {
    setAberto(v);
    if (v) {
      try {
        setNotificacoes(await notificacoesApi.listar());
      } catch {
        setNotificacoes([]);
      }
    }
  }

  async function handleClicarNotificacao(n: Notificacao) {
    if (n.lida) return;
    setNotificacoes((prev) => prev?.map((x) => (x.id === n.id ? { ...x, lida: true } : x)) ?? prev);
    setNaoLidas((prev) => Math.max(0, prev - 1));
    try {
      await notificacoesApi.marcarLida(n.id);
    } catch {
      void atualizarContagem();
    }
  }

  async function handleMarcarTodasLidas() {
    setNotificacoes((prev) => prev?.map((x) => ({ ...x, lida: true })) ?? prev);
    setNaoLidas(0);
    try {
      await notificacoesApi.marcarTodasLidas();
    } catch {
      void atualizarContagem();
    }
  }

  return (
    <Popover open={aberto} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" title="Notificações" aria-label="Notificações">
          <Bell />
          {naoLidas > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.65rem] font-bold leading-4 text-destructive-foreground">
              {naoLidas > 9 ? "9+" : naoLidas}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notificações</span>
          {naoLidas > 0 && (
            <button
              type="button"
              onClick={handleMarcarTodasLidas}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="size-3.5" />
              Marcar todas como lidas
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notificacoes === null ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-md" />
              ))}
            </div>
          ) : notificacoes.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Nenhuma notificação ainda.</p>
          ) : (
            notificacoes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClicarNotificacao(n)}
                className={cn(
                  "flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-secondary/60",
                  !n.lida && "bg-primary/5",
                )}
              >
                <span className="flex items-start gap-2 text-sm text-foreground">
                  {!n.lida && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />}
                  <span className={cn(!n.lida && "font-medium")}>{n.mensagem}</span>
                </span>
                <span className="pl-3.5 text-xs text-muted-foreground">
                  {new Date(n.criadoEm).toLocaleString("pt-BR")}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
