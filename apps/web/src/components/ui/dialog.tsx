import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Radix expõe "aberto/fechado" via data-attribute pra CSS puro. Pra animar a
 * saída com Framer Motion precisamos do booleano em React mesmo — daí este
 * contexto: `Dialog` espelha a prop `open` (sempre controlada nos usos atuais)
 * pra `DialogContent` decidir quando desmontar de verdade.
 */
const DialogOpenContext = React.createContext(false);

function Dialog({ open, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return (
    <DialogOpenContext.Provider value={open ?? false}>
      <DialogPrimitive.Root open={open} {...props} />
    </DialogOpenContext.Provider>
  );
}

const DialogTrigger = DialogPrimitive.Trigger;

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const isOpen = React.useContext(DialogOpenContext);
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen && (
        // forceMount em Portal/Overlay/Content: sem isso o Radix desmonta tudo
        // no instante em que `open` vira false, antes do AnimatePresence
        // conseguir tocar a saída. Quem decide o desmonte real agora é o
        // `{isOpen && ...}` acima, coordenado pelo AnimatePresence.
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay asChild forceMount>
            <motion.div
              initial={shouldReduceMotion ? false : "hidden"}
              animate="visible"
              exit={shouldReduceMotion ? undefined : "hidden"}
              variants={overlayVariants}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            />
          </DialogPrimitive.Overlay>
          <DialogPrimitive.Content asChild forceMount {...props}>
            <motion.div
              initial={shouldReduceMotion ? false : "hidden"}
              animate="visible"
              exit={shouldReduceMotion ? undefined : "hidden"}
              variants={contentVariants}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={cn(
                "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-card p-6 shadow-soft-lg",
                className,
              )}
            >
              {children}
              <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none">
                <X className="size-4" />
                <span className="sr-only">Fechar</span>
              </DialogPrimitive.Close>
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold leading-none", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex justify-end gap-2 pt-2", className)} {...props} />;
}

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
