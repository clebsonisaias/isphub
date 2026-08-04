import { expect, test, type Page } from "@playwright/test";

/**
 * CABEÇALHO — a navegação nunca pode sumir em silêncio.
 *
 * O nav do desktop é `flex-1 min-w-0 overflow-x-auto scrollbar-none`: ele cede
 * espaço e rola dentro de si. Isso NÃO é um defeito — foi a correção de um bug
 * pior, em que os controles da direita (busca, notificações, menu) eram
 * empurrados 111px pra fora da tela a 1440px.
 *
 * O problema é a barra de rolagem escondida: quando o nav cede, os itens somem
 * sem nenhuma pista. Foi o que aconteceu com o relógio de rede, que aparecia a
 * partir de 1536px e tomava 291px de uma barra travada em `max-w-7xl` (1280px)
 * — medido, o nav caía de 780px pra 490px e escondia 275px de itens. A
 * inversão era completa: quanto MAIOR a tela, menos menu.
 *
 * Estes testes vigiam as duas pontas ao mesmo tempo, porque consertar uma
 * quebrando a outra já aconteceu neste arquivo.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };

/** As larguras de desktop que importam, incluindo os breakpoints xl e 2xl. */
const LARGURAS = [1024, 1280, 1366, 1440, 1536, 1600, 1920];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

async function medirTopo(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector("header nav");
    const barra = document.querySelector("header .max-w-7xl");
    if (!nav || !barra) return null;
    const controles = barra.lastElementChild!.getBoundingClientRect();
    return {
      escondeItens: nav.scrollWidth > nav.clientWidth + 1,
      escondido: Math.round(nav.scrollWidth - nav.clientWidth),
      controlesForaDaTela: controles.right > window.innerWidth + 1,
      scrollHorizontalNaPagina: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

for (const largura of LARGURAS) {
  test(`topo a ${largura}px: menu inteiro visível e controles na tela`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 900 });
    await login(page);
    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();

    /*
     * `expect.poll`: o calculo de quantos itens cabem roda DEPOIS do primeiro
     * quadro (mede as larguras reais, e remede quando a fonte de display
     * carrega). Medir na hora le a tela antes do colapso — foi assim que este
     * teste acusou falha num comportamento que estava correto.
     */
    await expect
      .poll(async () => (await medirTopo(page))?.escondeItens, {
        message: "navegação escondida atrás de barra de rolagem invisível",
      })
      .toBe(false);

    const m = await medirTopo(page);
    expect(m).not.toBeNull();
    // A outra ponta: nada pode ser empurrado pra fora da tela.
    expect(m!.controlesForaDaTela).toBe(false);
    expect(m!.scrollHorizontalNaPagina).toBe(false);
  });
}

test("a hora de rede continua acessível — no menu do usuário", async ({ page }) => {
  /*
   * Ela saiu da linha do cabeçalho, mas NÃO foi removida: hora do servidor é
   * o que vale numa discussão de SLA, onde o relógio do computador de cada um
   * não serve de prova.
   */
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  await page.getByRole("button", { name: /Menu do usuário/ }).click();

  await expect(page.getByTitle(/Hora de rede/)).toBeVisible();
});

test("no celular a hora de rede também aparece (antes nunca era exibida)", async ({ page }) => {
  // Na linha do cabeçalho ela era `2xl:flex` — invisível abaixo de 1536px, ou
  // seja, nenhum técnico em campo via a hora de rede.
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);

  await page.getByRole("button", { name: /Menu do usuário/ }).click();

  await expect(page.getByTitle(/Hora de rede/)).toBeVisible();
});
