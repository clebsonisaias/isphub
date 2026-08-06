import { expect, test, type Page } from "@playwright/test";

/**
 * PARCELADOS — o caso central é a SOMA FECHAR.
 *
 * R$ 100,00 em 3x dá 33,3333...; arredondar cada parcela para 33,33 soma 99,99
 * e some um centavo. O ERP de origem trata isso (ajusta a última parcela), mas
 * em float — divide, arredonda, multiplica de volta e corrige a diferença. Aqui
 * a conta é em centavos inteiros: fechar não é conserto, é consequência. Este
 * spec confere na TELA, que é onde o centavo aparece ou some.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

const unico = (p: string) => `${p} ${Date.now()}`;
const linhaDe = (page: Page, texto: string) => page.getByRole("listitem").filter({ hasText: texto });

async function criar(page: Page, descricao: string, total: string, parcelas: string) {
  await page.getByRole("button", { name: "Novo parcelamento" }).click();
  await page.getByLabel("Descrição").fill(descricao);
  await page.getByLabel("Valor total").fill(total);
  await page.getByLabel("Parcelas").fill(parcelas);
  await page.getByRole("button", { name: /^Criar em/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linhaDe(page, descricao)).toBeVisible();
}

test("a aba existe e abre", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro");
  await page.getByRole("link", { name: "Parcelados" }).click();
  await expect(page).toHaveURL(/\/financeiro\/parcelados$/);
});

test("R$ 100 em 3x: a prévia mostra o centavo indo para a última", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/parcelados");

  await page.getByRole("button", { name: "Novo parcelamento" }).click();
  await page.getByLabel("Descrição").fill("Prévia");
  await page.getByLabel("Valor total").fill("100,00");
  await page.getByLabel("Parcelas").fill("3");

  const previa = page.getByText(/em diante/).locator("..");
  await expect(previa).toContainText("R$ 33,33");
  await expect(previa).toContainText("R$ 33,34");
  await expect(page.getByText(/a soma fecha em R\$ 100,00/)).toBeVisible();
});

test("as parcelas viram lançamentos e somam exatamente o total", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/parcelados");

  const descricao = unico("Notebook e2e");
  await criar(page, descricao, "100,00", "3");

  // Abre as parcelas e soma o que está na tela — em centavos, como o app nunca faz.
  await linhaDe(page, descricao).getByRole("button", { name: descricao }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();

  const valores = await dialogo.locator("li span.font-mono").allTextContents();
  expect(valores).toHaveLength(3);
  const centavos = valores.map((v) => Number(v.replace(/[^\d,]/g, "").replace(",", "")));
  expect(centavos.reduce((a, b) => a + b, 0)).toBe(10_000); // R$ 100,00 exatos
  expect(valores).toEqual(["R$ 33,33", "R$ 33,33", "R$ 33,34"]);
});

test("cada parcela aparece nomeada (n/N) na lista de lançamentos", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/parcelados");

  const descricao = unico("Servidor e2e");
  await criar(page, descricao, "300,00", "3");

  await page.goto("/financeiro");
  // O parcelamento nasce como DESPESA, e a lista abre em "A receber".
  await page.getByRole("tab", { name: "A pagar" }).click();
  await page.getByLabel("Buscar lançamento").fill(descricao);
  await expect(linhaDe(page, `${descricao} (1/3)`)).toBeVisible();
  await expect(linhaDe(page, `${descricao} (3/3)`)).toBeVisible();
  // E dá para dar baixa em UMA parcela — elas são lançamentos de verdade.
  await expect(
    linhaDe(page, `${descricao} (1/3)`).getByRole("button", { name: "Dar baixa" }),
  ).toBeVisible();
});

test("recusa menos de 2 parcelas", async ({ page }) => {
  // Uma parcela nao e parcelamento — e um lancamento comum.
  await login(page);
  await page.goto("/financeiro/parcelados");

  await page.getByRole("button", { name: "Novo parcelamento" }).click();
  await page.getByLabel("Descrição").fill("Uma só");
  await page.getByLabel("Valor total").fill("50,00");
  await page.getByLabel("Parcelas").fill("1");

  await expect(page.getByRole("button", { name: /^Criar em/ })).toBeDisabled();
});
