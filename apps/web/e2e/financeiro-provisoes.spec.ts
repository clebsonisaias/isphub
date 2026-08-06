import { expect, test, type Page } from "@playwright/test";

/**
 * PROVISÕES — quatro tipos, uma máquina só.
 *
 * O ERP de origem mantém um gerador SEPARADO para provisão (RPC própria,
 * "diferente do caminho das despesas"), e é exatamente por isso que um dos dois
 * duplicava e o outro não. Aqui provisão é uma recorrência com tipo — mesma
 * geração idempotente, mesma trava no banco.
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
const linhaDe = (page: Page, t: string) => page.getByRole("listitem").filter({ hasText: t });

async function criar(page: Page, descricao: string, valor: string) {
  await page.getByRole("button", { name: "Nova provisão" }).click();
  await page.getByLabel("Descrição").fill(descricao);
  await page.getByLabel("Valor").fill(valor);
  await page.getByRole("button", { name: "Criar provisão" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("a aba existe com os quatro tipos e seus contadores", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro");
  await page.getByRole("link", { name: "Provisões" }).click();
  await expect(page).toHaveURL(/\/financeiro\/provisoes$/);

  for (const t of ["Previsível", "Folha", "Tributos", "Obrigatório"]) {
    await expect(page.getByRole("tab", { name: new RegExp(t) })).toBeVisible();
  }
});

test("a provisão nasce no tipo da aba corrente", async ({ page }) => {
  // Quem está em "Tributos" quer criar uma de tributos — abrir sempre no
  // padrão obrigaria a corrigir o campo toda vez.
  await login(page);
  await page.goto("/financeiro/provisoes");

  await page.getByRole("tab", { name: /Tributos/ }).click();
  const descricao = unico("IRPJ e2e");
  await criar(page, descricao, "1200,00");

  await expect(linhaDe(page, descricao)).toBeVisible();
  // E não aparece na aba de outro tipo.
  await page.getByRole("tab", { name: /Folha/ }).click();
  await expect(linhaDe(page, descricao)).toHaveCount(0);
});

test("o contador da aba sobe junto", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/provisoes");
  await page.getByRole("tab", { name: /Folha/ }).click();

  const antes = Number((await page.getByRole("tab", { name: /Folha/ }).textContent())?.match(/(\d+)/)?.[1] ?? 0);
  await criar(page, unico("13º e2e"), "800,00");
  await expect
    .poll(async () => Number((await page.getByRole("tab", { name: /Folha/ }).textContent())?.match(/(\d+)/)?.[1] ?? 0))
    .toBe(antes + 1);
});

test("gera lançamentos e gerar de novo não duplica", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/provisoes");

  const descricao = unico("Férias e2e");
  await criar(page, descricao, "500,00");

  const lidos = async () =>
    Number((await linhaDe(page, descricao).textContent())?.match(/(\d+) lançamento/)?.[1] ?? -1);
  const antes = await lidos();
  expect(antes).toBeGreaterThan(0);

  await linhaDe(page, descricao).getByRole("button", { name: "Gerar" }).click();
  await expect(page.getByText(/Nada a gerar/)).toBeVisible();
  await page.reload();
  expect(await lidos()).toBe(antes);
});

test("a busca é da aba corrente e some ao trocar", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/provisoes");

  await page.getByLabel("Buscar provisão").fill("xyz-nao-existe");
  await expect(page.getByText("Nada encontrado nesta aba.")).toBeVisible();

  // Trocar de aba limpa a busca — senão a lista abriria vazia sem explicação.
  await page.getByRole("tab", { name: /Tributos/ }).click();
  await expect(page.getByLabel("Buscar provisão")).toHaveValue("");
});

test("provisão não polui a aba de recorrências", async ({ page }) => {
  // São a mesma tabela, separadas por um filtro — o recorte tem que valer.
  await login(page);
  await page.goto("/financeiro/provisoes");
  const descricao = unico("Separada e2e");
  await criar(page, descricao, "90,00");

  await page.goto("/financeiro/recorrencias");
  await expect(linhaDe(page, descricao)).toHaveCount(0);
});
