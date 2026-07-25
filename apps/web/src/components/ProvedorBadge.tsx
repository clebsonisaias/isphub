import type { Provedor } from "@isphub/shared";

/** Badge com a cor do provedor — usado para destacar a qual provedor pertence cada item. */
export function ProvedorBadge({ provedor }: { provedor: Pick<Provedor, "nome" | "cor" | "logoUrl"> }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-xs font-medium">
      {provedor.logoUrl ? (
        <img src={provedor.logoUrl} alt="" className="size-3.5 rounded-full object-cover" />
      ) : (
        <span className="size-2.5 rounded-full" style={{ backgroundColor: provedor.cor }} />
      )}
      {provedor.nome}
    </span>
  );
}
