import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  titulo: string;
  descricao?: string;
  variante: "sucesso" | "erro";
}

interface ToastContextValue {
  toast: (t: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

/** Sistema de toast minimalista (sem dependencia extra) para feedback de acoes administrativas. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const shouldReduceMotion = useReducedMotion();

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={shouldReduceMotion ? false : { opacity: 0, y: -12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={cn(
                "pointer-events-auto rounded-lg border p-3 text-sm shadow-lg backdrop-blur",
                t.variante === "sucesso"
                  ? "border-success/40 bg-success/10 text-foreground"
                  : "border-destructive/40 bg-destructive/10 text-foreground",
              )}
            >
              <p className="font-medium">{t.titulo}</p>
              {t.descricao && <p className="mt-0.5 text-muted-foreground">{t.descricao}</p>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve ser usado dentro de <ToastProvider>");
  return ctx;
}
