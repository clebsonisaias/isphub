import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Entrada de pagina padrao (fade + leve subida) — mecanismo UNICO de Framer
 * Motion pras paginas que nao tem uma entrada propria. Fila ja anima via
 * FilaWorkspace/FilaCard (stagger por item); Dashboard usa GSAP +
 * ScrollTrigger.batch DE PROPOSITO (reveal ligado a scroll, nao a montagem —
 * o unico caso onde GSAP continua sendo a ferramenta certa). Respeita
 * prefers-reduced-motion.
 */
export function AnimatedPage({ children }: { children: ReactNode }) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
