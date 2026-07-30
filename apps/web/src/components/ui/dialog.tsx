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
                /*
                 * `max-h` + `overflow-y-auto` nao sao acabamento: sem eles um
                 * dialog mais alto que a tela ficava cortado em cima E embaixo
                 * (medido: 77px de cada lado num iPhone), e como o elemento e
                 * `position: fixed` NAO havia como rolar ate as partes
                 * cortadas — o X de fechar e o rodape de acoes ficavam
                 * literalmente inalcancaveis no celular.
                 *
                 * `dvh` e nao `vh`: no mobile a barra de endereco entra e sai
                 * do calculo, e `vh` fixa a altura na maior, cortando de novo.
                 *
                 * `w-[calc(100%-1.5rem)]` da respiro nas laterais — `w-full`
                 * colava o card nas duas bordas da tela.
                 */
                "fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-4 shadow-soft-lg sm:w-full sm:p-6",
                className,
              )}
            >
              {children}
              {/*
                Fecha-dialog: era `size-4`, ou seja 16x16px de area de toque
                contra os 44px do minimo de acessibilidade. A area cresce (44px
                em ponteiro grosso, 36 no mouse) sem o icone mudar de tamanho.
                Segue `absolute` — em flow ele ocuparia uma linha do grid, e
                `sticky` num container com `gap` exigiria margem negativa pra
                cancelar o espaco. Como o dialog ABRE no topo, o X esta visivel
                exatamente quando se precisa dele; depois de rolar, Esc e o
                toque fora continuam fechando (comportamento do Radix).
              */}
              <DialogPrimitive.Close
                aria-label="Fechar"
                className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-md text-muted-foreground opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  // `pr-10`: o botao de fechar e `absolute` no canto — sem essa folga um
  // titulo longo passa por baixo do X e fica ilegivel justo no celular, onde
  // o titulo mais quebra linha.
  return <div className={cn("flex flex-col gap-1.5 pr-10", className)} {...props} />;
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
