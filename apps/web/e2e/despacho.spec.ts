import { expect, test, type Page } from "@playwright/test";

/**
 * FILTRO DE DESPACHO — "o que falta despachar" e "com quem esta cada uma".
 *
 * Antes desta secao, descobrir o que ainda nao tinha tecnico exigia varrer a
 * lista card a card: o trabalho PENDENTE ficava visualmente misturado com o
 * que ja estava em andamento, e nao havia como ver a carga de cada tecnico.
 *
 * O seed deixa e2e-os-1 despachada pro "E2E Tecnico" e e2e-os-sem-tipo sem
 * ninguem — os dois lados da secao.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };
const TECNICO_NOME = "E2E Tecnico";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

/** A linha da barra lateral, dentro da secao Despacho (evita casar com o card). */
function linhaDespacho(page: Page, nome: string | RegExp) {
  return page.getByRole("complementary").getByRole("button", { name: nome });
}

test("a secao Despacho separa o que falta despachar de quem ja tem dono", async ({ page }) => {
  await login(page);

  await expect(page.getByText("Despacho", { exact: true })).toBeVisible();
  await expect(linhaDespacho(page, /A despachar/)).toBeVisible();
  // O tecnico aparece porque TEM OS — a lista sai das proprias OS, nao do
  // cadastro (um provedor com 30 tecnicos nao vira 30 linhas zeradas).
  await expect(linhaDespacho(page, new RegExp(TECNICO_NOME))).toBeVisible();
});

test("filtrar por tecnico mostra so as OS dele", async ({ page }) => {
  await login(page);

  await linhaDespacho(page, new RegExp(TECNICO_NOME)).click();

  // e2e-os-1 e do tecnico; a sem tipo nao tem ninguem.
  await expect(page.getByText("Cliente E2E")).toBeVisible();
  await expect(page.getByText("Cliente Sem Tipo")).toHaveCount(0);
});

test("filtrar por 'A despachar' esconde o que ja foi despachado", async ({ page }) => {
  await login(page);

  await linhaDespacho(page, /A despachar/).click();

  await expect(page.getByText("Cliente Sem Tipo")).toBeVisible();
  await expect(page.getByText("Cliente E2E")).toHaveCount(0);
});

test("o filtro de despacho vira chip e o chip desfaz o filtro", async ({ page }) => {
  // Sem o chip, a lista curta parece "sumiram OS" em vez de "ha um filtro".
  await login(page);
  await linhaDespacho(page, /A despachar/).click();

  const chip = page.getByText(/Despacho: A despachar/);
  await expect(chip).toBeVisible();

  await page.getByRole("button", { name: /limpar filtros/i }).click();

  await expect(chip).toHaveCount(0);
  await expect(page.getByText("Cliente E2E")).toBeVisible();
  await expect(page.getByText("Cliente Sem Tipo")).toBeVisible();
});

test("'Todas as OS' tambem zera o filtro de despacho", async ({ page }) => {
  // Regressao: o atalho "Todas as OS" limpava status/prioridade/categoria/
  // provedor e DEIXAVA o despacho preso — a lista continuaria filtrada com o
  // botao "todas" aceso, que e a pior combinacao possivel.
  await login(page);
  await linhaDespacho(page, new RegExp(TECNICO_NOME)).click();
  await expect(page.getByText("Cliente Sem Tipo")).toHaveCount(0);

  await linhaDespacho(page, /Todas as OS/).click();

  await expect(page.getByText("Cliente Sem Tipo")).toBeVisible();
  await expect(page.getByText("Cliente E2E")).toBeVisible();
});
