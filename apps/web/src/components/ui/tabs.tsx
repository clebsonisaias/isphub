import type * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      /*
       * `max-w-full` + rolagem horizontal: com 3-4 abas de texto num celular de
       * 375px a lista passa da largura da tela, e `inline-flex` sozinho nao
       * quebra nem rola — as ultimas abas simplesmente ficavam fora de alcance.
       * `scrollbar-none` esconde a barra (o toque arrasta) sem esconder o
       * conteudo, que continua rolavel.
       */
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto scrollbar-none rounded-lg bg-secondary/50 p-1",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // `shrink-0` pra aba nao ser comprimida quando a lista rola; alvo de
        // 44px no dedo (ver a nota em button.tsx sobre pointer-coarse).
        "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-soft-sm pointer-coarse:min-h-11 pointer-coarse:px-4",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-4", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
