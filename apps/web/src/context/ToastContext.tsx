import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, XCircle, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  titulo: string;
  descricao?: string;
  variante: "sucesso" | "erro" | "info";
}

interface ToastContextValue {
  toast: (t: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/** Hierarquia por variante — cor + icone, tokens semanticos (sucesso/destructive) ou indigo pra info. */
const VARIANTE_ESTILO: Record<Toast["variante"], { classe: string; icone: LucideIcon; iconeClasse: string }> = {
  sucesso: { classe: "border-success/40 bg-success/10", icone: CheckCircle2, iconeClasse: "text-success" },
  erro: { classe: "border-destructive/40 bg-destructive/10", icone: XCircle, iconeClasse: "text-destructive" },
  info: { classe: "border-primary/30 bg-primary/10", icone: Info, iconeClasse: "text-primary" },
};

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

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => {
            const estilo = VARIANTE_ESTILO[t.variante];
            const Icone = estilo.icone;
            return (
              <motion.div
                key={t.id}
                layout
                initial={shouldReduceMotion ? false : { opacity: 0, y: -12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className={cn(
                  "pointer-events-auto flex items-start gap-2.5 rounded-lg border p-3 text-sm shadow-soft-lg backdrop-blur",
                  estilo.classe,
                  "text-foreground",
                )}
              >
                <Icone className={cn("mt-0.5 size-4 shrink-0", estilo.iconeClasse)} />
                <div className="min-w-0">
                  <p className="font-medium">{t.titulo}</p>
                  {t.descricao && <p className="mt-0.5 text-muted-foreground">{t.descricao}</p>}
                </div>
              </motion.div>
            );
          })}
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
