import { expect, test, type Page } from "@playwright/test";

/**
 * NAVEGAÇÃO DO DESKTOP — nenhum item pode sumir em silêncio.
 *
 * Até 11/2026 a navegação era uma linha de abas no cabeçalho, e este arquivo
 * vigiava o que ela fazia quando não cabia: itens escondidos atrás de uma
 * barra de rolagem invisível, ou os controles da direita empurrados pra fora
 * da tela. Com o menu LATERAL o problema muda de eixo, mas a regra é a mesma:
 * todo item que o usuário pode abrir tem de estar à vista e com o nome
 * inteiro, e nada pode estourar a largura da página.
 *
 * As duas pontas continuam vigiadas juntas (menu de um lado, controles do
 * topo do outro), porque consertar uma quebrando a outra já aconteceu aqui.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };

/** As larguras de desktop que importam, incluindo os breakpoints xl e 2xl. */
const LARGURAS = [1024, 1280, 1366, 1440, 1536, 1600, 1920];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Seu usuário ou e-mail").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  // Cada papel cai na SUA tela inicial (admin e gestor: Despacho), entao o que
  // se espera e sair do login, nao chegar numa rota especifica.
  await expect(page).not.toHaveURL(/\/login/);
}

async function medirNavegacao(page: Page) {
  return page.evaluate(() => {
    const menu = document.querySelector("aside nav");
    const topo = document.querySelector("header > div");
    if (!menu || !topo) return null;
    const links = [...menu.querySelectorAll<HTMLAnchorElement>("a[data-nav-item]")];
    const caixaMenu = menu.getBoundingClientRect();
    const controles = topo.lastElementChild!.getBoundingClientRect();
    return {
      itens: links.length,
      // Nome cortado com reticencias: o rotulo existe, mas nao da pra ler.
      cortados: links.filter((a) => {
        const rotulo = a.querySelector("span");
        return !!rotulo && rotulo.scrollWidth > rotulo.clientWidth + 1;
      }).length,
      // Fora da caixa do menu na horizontal: escondido sem pista nenhuma.
      foraDoMenu: links.filter((a) => {
        const r = a.getBoundingClientRect();
        return r.left < caixaMenu.left - 1 || r.right > caixaMenu.right + 1;
      }).length,
      // Na vertical o menu PODE rolar (tela baixa), desde que a rolagem exista.
      rolaNaVertical: menu.scrollHeight > menu.clientHeight + 1,
      podeRolar: getComputedStyle(menu).overflowY === "auto" || getComputedStyle(menu).overflowY === "scroll",
      controlesForaDaTela: controles.right > window.innerWidth + 1,
      scrollHorizontalNaPagina: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

for (const largura of LARGURAS) {
  test(`navegação a ${largura}px: menu inteiro legível e controles na tela`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 900 });
    await login(page);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav).toBeVisible();
    // O item de Administração depende de `/config` (módulos): espera assentar.
    await expect(nav.getByRole("link", { name: "Administração" })).toBeVisible();

    const m = await medirNavegacao(page);
    expect(m).not.toBeNull();
    expect(m!.itens).toBeGreaterThanOrEqual(10);
    expect(m!.cortados, "rótulo de menu cortado com reticências").toBe(0);
    expect(m!.foraDoMenu, "item fora da caixa do menu").toBe(0);
    if (m!.rolaNaVertical) expect(m!.podeRolar).toBe(true);
    // A outra ponta: nada pode ser empurrado pra fora da tela.
    expect(m!.controlesForaDaTela).toBe(false);
    expect(m!.scrollHorizontalNaPagina).toBe(false);
  });
}

test("no desktop a página atual fica marcada no menu", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
});

test("abaixo de 1024px o menu lateral some e a barra do rodapé assume", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await expect(page.locator("aside")).toBeHidden();
  // Uma navegação só na árvore de acessibilidade — nunca as duas.
  await expect(page.getByRole("navigation", { name: "Navegação principal" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Mais seções/ })).toBeVisible();
});

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
