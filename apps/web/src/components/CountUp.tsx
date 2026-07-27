import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsapSetup";

/** Anima um numero de 0 ate `value` (micro-interacao escopada ao dashboard, ver plano). */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        ref.current.textContent = Math.round(value).toLocaleString("pt-BR");
        return;
      }
      const obj = { n: 0 };
      gsap.to(obj, {
        n: value,
        duration: 0.7,
        ease: "power1.out", // equivalente GSAP do "outQuad" do anime.js original
        onUpdate: () => {
          if (ref.current) ref.current.textContent = Math.round(obj.n).toLocaleString("pt-BR");
        },
      });
    },
    { dependencies: [value] },
  );

  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}
