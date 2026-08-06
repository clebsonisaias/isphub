import { expect, test, type Page } from "@playwright/test";

/**
 * PONTUAIS e SERVIÇOS — a mesma lista com um recorte.
 *
 * Não são telas novas de propósito: na origem as duas abas compartilham a
 * tabela `lancamentos_pontuais`, distinguidas por um campo. Duas telas quase
 * iguais seriam duas coisas para manter e um lugar a mais para divergir.
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

test("as duas abas existem e recortam a mesma lista", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro");

  await page.getByRole("link", { name: "Pontuais" }).click();
  await expect(page).toHaveURL(/origem=avulso/);
  await expect(page.getByText("Só lançamentos avulsos")).toBeVisible();
  await expect(page.getByText(/é a mesma lista com um recorte/)).toBeVisible();

  await page.getByRole("link", { name: "Serviços" }).click();
  await expect(page).toHaveURL(/servico=true/);
  await expect(page.getByText("Só notas fiscais de serviço")).toBeVisible();
});

test("nota de serviço aparece em Serviços e some fora dele", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro");
  await page.getByRole("tab", { name: "A pagar" }).click();

  const descricao = unico("Contabilidade e2e");
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  await page.getByLabel("Descrição").fill(descricao);
  await page.getByLabel("Valor").fill("450,00");
  await page.getByLabel("Nota / documento").fill("NFS-9911");
  await page.getByLabel("Serviço tomado").check();
  await page.getByRole("button", { name: "Criar lançamento" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/financeiro?servico=true");
  await page.getByRole("tab", { name: "A pagar" }).click();
  await expect(linhaDe(page, descricao)).toBeVisible();

  // Um lançamento comum NÃO entra no recorte de serviço.
  const comum = unico("Comum e2e");
  await page.goto("/financeiro");
  await page.getByRole("tab", { name: "A pagar" }).click();
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  await page.getByLabel("Descrição").fill(comum);
  await page.getByLabel("Valor").fill("10,00");
  await page.getByRole("button", { name: "Criar lançamento" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/financeiro?servico=true");
  await page.getByRole("tab", { name: "A pagar" }).click();
  await expect(linhaDe(page, comum)).toHaveCount(0);
});

test("a busca alcança o número da nota", async ({ page }) => {
  // Conciliar com o papel começa por procurar o número — sem campo próprio isso
  // ia parar na observação e não dava para buscar.
  await login(page);
  await page.goto("/financeiro");
  await page.getByRole("tab", { name: "A pagar" }).click();

  const descricao = unico("Com nota e2e");
  const nota = `NF-${Date.now()}`;
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  await page.getByLabel("Descrição").fill(descricao);
  await page.getByLabel("Valor").fill("77,00");
  await page.getByLabel("Nota / documento").fill(nota);
  await page.getByRole("button", { name: "Criar lançamento" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByLabel("Buscar lançamento").fill(nota);
  await expect(linhaDe(page, descricao)).toBeVisible();
});

test("Pontuais exclui o que veio de recorrência", async ({ page }) => {
  // "Avulso" é a AUSÊNCIA de vínculo — se o filtro fosse por um campo gravado,
  // ele poderia divergir do que a lista mostra.
  await login(page);
  await page.goto("/financeiro/recorrencias");

  const descricao = unico("Da recorrência e2e");
  await page.getByRole("button", { name: "Nova recorrência" }).click();
  await page.getByLabel("Descrição").fill(descricao);
  await page.getByLabel("Valor").fill("120,00");
  await page.getByRole("button", { name: "Criar recorrência" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Aparece na lista completa…
  await page.goto("/financeiro");
  await page.getByLabel("Buscar lançamento").fill(descricao);
  await expect(linhaDe(page, descricao).first()).toBeVisible();

  // …e some no recorte de avulsos.
  await page.goto("/financeiro?origem=avulso");
  await page.getByLabel("Buscar lançamento").fill(descricao);
  await expect(linhaDe(page, descricao)).toHaveCount(0);
});

test("'Ver todos' sai do recorte", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro?origem=avulso");
  await expect(page.getByText("Só lançamentos avulsos")).toBeVisible();

  await page.getByRole("button", { name: "Ver todos" }).click();
  await expect(page.getByText("Só lançamentos avulsos")).toHaveCount(0);
  await expect(page).not.toHaveURL(/origem=/);
});

test("a origem aparece no detalhe do lançamento", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro");
  await page.getByRole("tab", { name: "A pagar" }).click();

  const descricao = unico("Origem e2e");
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  await page.getByLabel("Descrição").fill(descricao);
  await page.getByLabel("Valor").fill("15,00");
  await page.getByRole("button", { name: "Criar lançamento" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await linhaDe(page, descricao).getByRole("button", { name: descricao }).click();
  await expect(page.getByRole("dialog").getByText("Avulso")).toBeVisible();
});
