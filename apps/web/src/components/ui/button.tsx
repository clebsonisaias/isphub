import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * `shrink-0` anda junto do `whitespace-nowrap` que ja estava aqui: um rotulo
 * que nunca quebra linha, num botao que o flexbox pode comprimir, e overflow
 * garantido. Medido: "Novo provedor" espremido a 88px com 106px de conteudo
 * fazia a pagina inteira rolar na horizontal, e um botao de icone chegava a
 * ser comprimido aos 16px do proprio svg. Quem cede espaco numa linha e o
 * TEXTO ao lado (com `min-w-0`), nunca o botao.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        brand: "brand-gradient-bg text-white hover:brightness-110 shadow-lg shadow-primary/20",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-border bg-transparent hover:bg-secondary",
        ghost: "hover:bg-secondary hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /*
       * `pointer-coarse:` e nao um breakpoint: o que exige 44px e o DEDO, nao a
       * largura da tela. Um tablet de 1024px com toque precisa do alvo grande;
       * uma janela de desktop estreitada a 375px, com mouse, nao — e encher de
       * botoes gordos no desktop desperdicaria o espaco da tela.
       *
       * `min-h-11` sobre `h-8`: min-height ganha de height, entao o mesmo
       * botao tem 32px no mouse e 44px no dedo sem duas classes competindo.
       */
      size: {
        default: "h-10 px-4 py-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        sm: "h-8 rounded-md px-3 text-xs pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-4",
        lg: "h-11 rounded-md px-8",
        icon: "size-10 pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
