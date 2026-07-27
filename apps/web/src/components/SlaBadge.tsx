import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsapSetup";
import type { SlaInfo } from "@isphub/shared";
import { cn } from "@/lib/utils";

/**
 * Semaforo de SLA (status reservado: verde=ok, amarelo=atenção, vermelho=estourado).
 * Nunca so a cor — sempre pareado com rotulo de texto.
 */
const SLA_STYLE: Record<SlaInfo["semaforo"], { dot: string; texto: string; label: string }> = {
  verde: { dot: "bg-success", texto: "text-success", label: "No prazo" },
  amarelo: { dot: "bg-warning", texto: "text-warning", label: "Atenção" },
  vermelho: { dot: "bg-destructive", texto: "text-destructive", label: "Estourado" },
  sem_sla: { dot: "bg-muted-foreground/40", texto: "text-muted-foreground", label: "Sem SLA" },
};

export function SlaBadge({ sla }: { sla: SlaInfo }) {
  const s = SLA_STYLE[sla.semaforo];
  const detalhe =
    sla.semaforo !== "sem_sla" && typeof sla.minutosRestantes === "number" ? formatMinutos(sla.minutosRestantes) : null;
  const estourado = sla.semaforo === "vermelho";
  const dotRef = useRef<HTMLSpanElement>(null);

  // SLA estourado pulsa pra chamar atencao — respeita prefers-reduced-motion.
  useGSAP(() => {
    if (!estourado || !dotRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.to(dotRef.current, {
      scale: 1.7,
      opacity: 0.35,
      duration: 0.9,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
  }, { dependencies: [estourado] });

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", s.texto)}>
      <span ref={dotRef} className={cn("size-2 rounded-full", s.dot)} />
      {s.label}
      {detalhe && <span className="text-muted-foreground">({detalhe})</span>}
    </span>
  );
}

function formatMinutos(min: number): string {
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const texto = h > 0 ? `${h}h${m ? ` ${m}min` : ""}` : `${m}min`;
  return min < 0 ? `${texto} atrasado` : `${texto} restantes`;
}

/** Ordem de urgencia para ordenação (menor = mais urgente). */
export const SLA_PRIORIDADE: Record<SlaInfo["semaforo"], number> = {
  vermelho: 0,
  amarelo: 1,
  verde: 2,
  sem_sla: 3,
};
