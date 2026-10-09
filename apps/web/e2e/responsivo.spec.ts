import { test, expect, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";

const RELATORIO = "/tmp/isphub-responsivo.txt";

/**
 * Auditoria de responsividade: percorre TODA rota autenticada em 4 larguras e
 * mede — nao inspeciona visualmente — tres defeitos que fazem o painel "nao
 * caber" ou "esconder coisas":
 *
 *  1. scroll horizontal na pagina (o sintoma classico de "nao esta responsivo")
 *  2. elemento que estoura a viewport (a CAUSA do item 1, com nome e seletor)
 *  3. conteudo cortado por overflow:hidden sem como alcancar ("coisas escondidas")
 *
 * Roda como teste pra virar regressao: qualquer layout novo que estourar 375px
 * quebra a suite em vez de chegar no celular do usuario.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };

/**
 * 375 = iPhone SE/13 mini (o piso real); 1440 = notebook.
 *
 * `toque` importa: os minimos de 44px sao aplicados por `pointer-coarse:` (o
 * que exige alvo grande e o DEDO, nao a largura). Sem emular toque, o navegador
 * reporta `pointer: fine`, as regras de 44px nao entram, e a auditoria mediria
 * os tamanhos de mouse — aprovando exatamente o que quebra no celular.
 */
const LARGURAS = [
  { nome: "375 (celular)", w: 375, h: 812, toque: true },
  { nome: "768 (tablet)", w: 768, h: 1024, toque: true },
  { nome: "1024 (tablet paisagem)", w: 1024, h: 768, toque: true },
  { nome: "1440 (notebook)", w: 1440, h: 900, toque: false },
];

const ROTAS = [
  "/",
  "/mapa",
  "/retiradas",
  "/dashboard",
  "/provisionamento",
  "/chat",
  "/chat-clientes",
  "/perfil",
  "/admin",
  "/admin/categorias",
  "/admin/usuarios",
  "/admin/modulos",
  "/admin/canais-whatsapp",
];

type Achado = {
  rota: string;
  largura: string;
  tipo: "scroll-horizontal" | "estoura-viewport" | "conteudo-cortado" | "alvo-pequeno";
  detalhe: string;
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

/**
 * Roda DENTRO da pagina: o DOM real e a unica fonte de verdade aqui — dá pra
 * ler classe Tailwind a semana toda e nao descobrir qual elemento estoura.
 */
async function medir(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollDaPagina = document.documentElement.scrollWidth - vw;

    /** Algum ancestral rola na horizontal? Se sim, sair da tela e por desenho. */
    function dentroDeRolavelX(el: Element): boolean {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    }

    function nomear(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 6).join(".");
      const txt = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${tag}${cls ? "." + cls : ""}${txt ? ` «${txt}»` : ""}`;
    }

    const estouram: string[] = [];
    const cortados: string[] = [];
    const alvosPequenos: string[] = [];

    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      /*
       * O Leaflet e isento por natureza, nao por conveniencia: um mapa E um
       * recorte sobre uma superficie maior que a tela. Os tiles ficam
       * posicionados fora do container de proposito e o `overflow: hidden` do
       * container e o mecanismo do mapa, nao conteudo perdido — o que estiver
       * fora se alcanca arrastando. Medir isso como defeito afogaria o
       * relatorio em ruido e esconderia os achados de verdade.
       */
      if (el.closest(".leaflet-container")) continue;

      const estilo = getComputedStyle(el);
      if (estilo.display === "none" || estilo.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      /*
       * 1) estoura a viewport. Tolerancia de 1px pra subpixel.
       *
       * Ignora `position: fixed` fora de tela de proposito (drawer fechado) e
       * — importante — o que esta dentro de um ancestral que ROLA na
       * horizontal: uma faixa de abas rolavel passa da tela por desenho, e o
       * conteudo continua alcancavel. O defeito e sair da tela SEM rolagem.
       */
      if (estilo.position !== "fixed" && !dentroDeRolavelX(el) && (r.right > vw + 1 || r.left < -1)) {
        // So reporta o elemento mais externo do estouro: senao um card largo
        // reporta ele + todos os filhos e o relatorio vira ruido.
        const paiEstoura = el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1;
        if (!paiEstoura) estouram.push(`${nomear(el)} → direita ${Math.round(r.right)}px (viewport ${vw}px)`);
      }

      // 2) conteudo cortado sem como alcancar: overflow hidden/clip E o
      // conteudo e maior que a caixa. Se fosse auto/scroll, daria pra rolar.
      const escondeX = estilo.overflowX === "hidden" || estilo.overflowX === "clip";
      if (escondeX && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        // `truncate` (text-overflow: ellipsis) e corte INTENCIONAL e sinalizado.
        // `sr-only` tambem: caixa de 1x1 recortada de proposito, so pra leitor
        // de tela (e o nome completo das abas da nav vive assim).
        const soLeitorDeTela = el.clientWidth <= 1 && el.clientHeight <= 1;
        if (estilo.textOverflow !== "ellipsis" && !soLeitorDeTela) {
          cortados.push(`${nomear(el)} → conteudo ${el.scrollWidth}px numa caixa de ${el.clientWidth}px`);
        }
      }

      /*
       * 3) alvo de toque abaixo de 44px — so onde ha DEDO, so no clicavel.
       *
       * Mede a area EFETIVA, nao a caixa: um `::before` absoluto com inset
       * negativo estende o alcance do toque sem inflar o visual (e como o
       * switch de 20x36px chega aos 44 — ver switch.tsx). Ler so o
       * getBoundingClientRect acusaria um controle que na pratica ja e
       * grande o bastante.
       */
      if (matchMedia("(pointer: coarse)").matches) {
        const clicavel =
          el.tagName === "BUTTON" ||
          el.tagName === "A" ||
          el.getAttribute("role") === "button" ||
          el.tagName === "INPUT" ||
          el.tagName === "SELECT";
        // `classList`, nao `className`: em elementos SVG `className` e um
        // SVGAnimatedString, e chamar `.includes` nele estoura.
        const emLinhaDeTexto = estilo.display === "inline" || el.classList.contains("truncate");
        if (clicavel && !emLinhaDeTexto && !(el as HTMLButtonElement).disabled) {
          const antes = getComputedStyle(el, "::before");
          const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : 0);
          const estende = antes.content !== "none" && antes.position === "absolute";
          const larguraEfetiva = r.width - (estende ? px(antes.left) + px(antes.right) : 0);
          const alturaEfetiva = r.height - (estende ? px(antes.top) + px(antes.bottom) : 0);
          if (alturaEfetiva < 40 || larguraEfetiva < 40) {
            const nota =
              larguraEfetiva !== r.width || alturaEfetiva !== r.height
                ? ` (caixa ${Math.round(r.width)}×${Math.round(r.height)} + ::before)`
                : "";
            alvosPequenos.push(`${nomear(el)} → ${Math.round(larguraEfetiva)}×${Math.round(alturaEfetiva)}px${nota}`);
          }
        }
      }
    }

    /*
     * Dialog cortado na VERTICAL. A primeira versao desta auditoria so media a
     * horizontal e passou batido no pior defeito do painel: o dialog de detalhe
     * da OS tinha 965px de altura numa tela de 812, centrado com translate —
     * 77px cortados em cima (incluindo o X de fechar) e 77 embaixo, e como o
     * elemento e `position: fixed` NAO havia como rolar ate eles.
     */
    const dialogsCortados: string[] = [];
    for (const d of Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))) {
      if (getComputedStyle(d).display === "none") continue;
      const r = d.getBoundingClientRect();
      if (r.height === 0) continue;
      const podeRolar = ["auto", "scroll"].includes(getComputedStyle(d).overflowY);
      if (!podeRolar && (r.top < -1 || r.bottom > innerHeight + 1)) {
        dialogsCortados.push(
          `dialog ${Math.round(r.height)}px de altura em tela de ${innerHeight}px, sem rolagem própria` +
            ` → ${Math.round(Math.max(0, -r.top))}px cortados acima, ${Math.round(Math.max(0, r.bottom - innerHeight))}px abaixo`,
        );
      }
    }

    return { scrollDaPagina, estouram, cortados, alvosPequenos, dialogsCortados, vw };
  });
}

/**
 * Um teste POR LARGURA: o painel mantem um SSE aberto pro realtime, entao
 * `networkidle` nunca resolve (foi o que estourou o timeout na primeira
 * versao). Espera-se por elemento estavel + um tick curto.
 */
for (const { nome, w, h, toque } of LARGURAS) {
  test(`responsividade em ${nome}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: toque });
    const page = await context.newPage();
    await login(page);

    const achados: Achado[] = [];
    for (const rota of ROTAS) {
      await page.goto(rota, { waitUntil: "domcontentloaded" });
      // O AppShell e o esqueleto comum a toda rota autenticada; quando ele
      // esta la, a pagina montou. O tick cobre o fetch dos dados.
      await page.locator("header").first().waitFor({ timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(900);
      /*
       * Espera as animacoes ASSENTAREM antes de medir. A pilula de rota ativa
       * desliza entre posicoes (Framer Motion, layoutId) e medir no meio do
       * voo acusava 3px de estouro que nao existem no layout final — falso
       * positivo que deixaria este teste piscando.
       */
      await page
        .waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, {
          timeout: 5_000,
        })
        .catch(() => {});

      const m = await medir(page);
      for (const d of m.dialogsCortados) achados.push({ rota, largura: nome, tipo: "conteudo-cortado", detalhe: d });
      if (m.scrollDaPagina > 1) {
        achados.push({ rota, largura: nome, tipo: "scroll-horizontal", detalhe: `pagina rola ${m.scrollDaPagina}px na horizontal` });
      }
      for (const d of m.estouram.slice(0, 6)) achados.push({ rota, largura: nome, tipo: "estoura-viewport", detalhe: d });
      for (const d of m.cortados.slice(0, 6)) achados.push({ rota, largura: nome, tipo: "conteudo-cortado", detalhe: d });
      for (const d of m.alvosPequenos.slice(0, 8)) achados.push({ rota, largura: nome, tipo: "alvo-pequeno", detalhe: d });
    }

    const relatorio = achados.map((a) => `[${a.tipo}] ${a.rota}\n    ${a.detalhe}`).join("\n");
    appendFileSync(RELATORIO, `\n##### ${nome} — ${achados.length} achados\n${relatorio}\n`);
    await context.close();

    // Trava a regressao: qualquer layout novo que estoure a tela, esconda
    // conteudo sem como alcancar, ou entregue alvo de toque abaixo de 40px
    // quebra AQUI, e nao no celular de quem usa.
    expect(achados, `\n${relatorio}\n`).toEqual([]);
  });
}
