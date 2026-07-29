import { MensagemClienteDirecao, type MensagemClienteDTO } from "@isphub/shared";
import { cn } from "@/lib/utils";

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Bolha da thread com cliente. Autor e hora ficam SEMPRE visíveis na saída:
 * como ADMIN/GESTOR podem intervir sem virar donos da conversa, uma thread sem
 * autor não deixa auditar quem falou — o técnico ou o gestor por cima dele.
 */
export function MensagemClienteBolha({ mensagem }: { mensagem: MensagemClienteDTO }) {
  const saida = mensagem.direcao === MensagemClienteDirecao.SAIDA;

  return (
    <div className={cn("mb-2 flex", saida ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex max-w-[70%] flex-col gap-1 rounded-lg px-3 py-2 text-sm",
          saida ? "bg-primary text-primary-foreground" : "border border-border bg-card",
        )}
      >
        {saida && mensagem.autorNome && <span className="text-[0.65rem] font-semibold opacity-80">{mensagem.autorNome}</span>}
        {mensagem.templateNome && (
          <span
            className={cn(
              "w-fit rounded-full px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide",
              saida ? "bg-primary-foreground/15" : "bg-secondary text-muted-foreground",
            )}
            title={`Template ${mensagem.templateNome}`}
          >
            Template · {mensagem.templateNome}
          </span>
        )}
        <p className="whitespace-pre-wrap break-words">{mensagem.corpo}</p>
        <span className="self-end font-mono text-[0.65rem] opacity-70">{formatHora(mensagem.criadoEm)}</span>
        {mensagem.falhaEnvio && (
          <p className={cn("text-xs", saida ? "text-primary-foreground/90" : "text-destructive")}>Falha ao enviar: {mensagem.falhaEnvio}</p>
        )}
      </div>
    </div>
  );
}
