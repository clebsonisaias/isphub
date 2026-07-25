import { cn } from "@/lib/utils";

/** Meter compacto (fill proporcional) para comparar magnitudes numa tabela. */
export function MiniMeter({ value, max, colorClassName }: { value: number; max: number; colorClassName: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className={cn("h-full rounded-full transition-all", colorClassName)} style={{ width: `${pct}%` }} />
    </div>
  );
}
