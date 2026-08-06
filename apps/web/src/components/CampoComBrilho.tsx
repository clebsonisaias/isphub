import { useRef, type ReactNode } from "react";

/**
 * Envolve um campo e acende dois filetes de 2px — topo e base — que seguem o
 * cursor na horizontal.
 *
 * NAO toca no `Input` compartilhado (components/ui/input.tsx): ele e usado em
 * toda a aplicacao, e este brilho e desta tela. O efeito vive na casca.
 *
 * SEM ESTADO REACT. O componente de origem chamava `setMousePosition` a cada
 * `mousemove`, o que re-renderiza a arvore inteira a cada quadro — num
 * formulario de login isso significa recalcular a pagina toda enquanto o mouse
 * passeia por cima de um campo de texto. Aqui o `mousemove` escreve UMA custom
 * property no proprio elemento, e o gradiente le `var(--brilho-x)`. Uma escrita
 * de estilo por quadro, zero re-render.
 *
 * A cor e `--ring`, que ja e o token de foco do projeto — o brilho e a versao
 * continua do mesmo sinal, nao uma cor nova.
 */
export function CampoComBrilho({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="group/brilho relative"
      /*
       * `onPointerMove` (nao `onMouseMove`): no toque, `mousemove` so dispara
       * uma vez depois do tap e deixaria o brilho CONGELADO num ponto do campo
       * — um artefato parado, que parece defeito. Com pointer da pra ignorar
       * quem nao e mouse.
       */
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        ref.current.style.setProperty("--brilho-x", `${e.clientX - rect.left}px`);
        ref.current.style.setProperty("--brilho-op", "1");
      }}
      onPointerLeave={() => ref.current?.style.setProperty("--brilho-op", "0")}
      style={{ ["--brilho-op" as string]: "0" }}
    >
      {children}

      {/*
        `aria-hidden` + `pointer-events-none`: e decoracao pura. Sem isso os
        filetes ficariam por cima do input e roubariam o clique.

        `motion-reduce:hidden` — um brilho perseguindo o cursor e movimento, e
        quem pediu menos movimento pediu menos disto tambem.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] rounded-t-md transition-opacity duration-200 motion-reduce:hidden"
        style={{
          opacity: "var(--brilho-op)",
          background:
            "radial-gradient(30px circle at var(--brilho-x, 50%) 0px, var(--ring) 0%, transparent 70%)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] rounded-b-md transition-opacity duration-200 motion-reduce:hidden"
        style={{
          opacity: "var(--brilho-op)",
          background:
            "radial-gradient(30px circle at var(--brilho-x, 50%) 2px, var(--ring) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}
