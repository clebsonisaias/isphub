import { useEffect, useRef } from "react";
import { animate } from "animejs";

/** Anima um numero de 0 ate `value` (micro-interacao escopada ao dashboard, ver plano). */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const obj = { n: 0 };
    const anim = animate(obj, {
      n: value,
      duration: 700,
      ease: "outQuad",
      onUpdate: () => {
        if (ref.current) ref.current.textContent = Math.round(obj.n).toLocaleString("pt-BR");
      },
    });
    return () => {
      anim.pause();
    };
  }, [value]);

  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}
