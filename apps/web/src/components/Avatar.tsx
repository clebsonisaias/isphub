import { iniciais, cn } from "@/lib/utils";

const TAMANHOS = {
  sm: "size-7 text-[0.65rem]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

/**
 * Avatar circular com iniciais — usado no chat (lista de conversas, bolhas,
 * cabecalho da thread) e no seletor de contatos. `online` desenha um anel
 * de status (verde=online, cinza=offline); omitido quando a presenca nao
 * se aplica (ex.: avatar de grupo).
 */
export function Avatar({
  nome,
  size = "md",
  online,
  className,
}: {
  nome: string;
  size?: keyof typeof TAMANHOS;
  online?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "flex items-center justify-center rounded-full border border-border bg-secondary font-display font-semibold text-foreground",
          TAMANHOS[size],
        )}
      >
        {iniciais(nome)}
      </span>
      {online !== undefined && (
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background",
            online ? "bg-success" : "bg-muted-foreground/40",
          )}
        />
      )}
    </span>
  );
}
