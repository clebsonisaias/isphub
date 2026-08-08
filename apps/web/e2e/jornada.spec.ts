import { expect, test } from "@playwright/test";

/**
 * JORNADA — o gestor precisa saber quem está na rua.
 *
 * Despachar sem isso é adivinhação: a fila mostra nomes, mas nada dizia se
 * aquela pessoa já tinha ido embora. O seed deixa o técnico e2e com uma jornada
 * aberta há 2h.
 */

test("o Dashboard mostra quem está em jornada, e há quanto tempo", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill("e2e-admin@isphub.test");
  await page.getByLabel("Senha", { exact: true }).fill("e2e-senha-123");
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");

  await page.goto("/dashboard");

  const bloco = page.getByText("Em jornada agora").locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
  await expect(bloco).toBeVisible();
  await expect(bloco.getByText("E2E Tecnico")).toBeVisible();
  // 2h de jornada, no formato "2h00" — o mesmo que o app do técnico mostra,
  // porque as duas pontas usam a função de `@isphub/shared`.
  await expect(bloco.getByText(/^\d+h\d{2}$/)).toBeVisible();
});

test("técnico NÃO enxerga a jornada dos colegas", async ({ page }) => {
  /*
   * `/jornada/ativas` é informação sobre OUTRAS pessoas. Um técnico vê a
   * própria por `/atual` e não tem por que enxergar a dos colegas — a guarda
   * é do servidor, não da tela que esconde o bloco.
   */
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill("e2e-tecnico@isphub.test");
  await page.getByLabel("Senha", { exact: true }).fill("e2e-senha-123");
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");

  const r = await page.evaluate(async () => {
    const token = localStorage.getItem("isphub_token");
    const res = await fetch("http://localhost:4000/jornada/ativas", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status;
  });

  expect(r).toBe(403);
});
