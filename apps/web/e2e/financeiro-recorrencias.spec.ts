import { expect, test, type Page } from "@playwright/test";

/**
 * RECORRÊNCIAS — a regra que gera lançamentos repetidos.
 *
 * O caso central e a IDEMPOTENCIA. O ERP de origem tinha um botao de
 * sincronizar que inseria sem verificar nada: cada clique criava um conjunto
 * completo novo, e o changelog deles registra "tres chamadas seguidas deixam 12
 * lancamentos, nao 36" como correcao. Aqui a trava e a unicidade
 * (recorrenciaId, vencimento) no banco — e este spec clica tres vezes.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

function unico(prefixo: string) {
  return `${prefixo} ${Date.now()}`;
}

function linhaDe(page: Page, descricao: string) {
  return page.getByRole("listitem").filter({ hasText: descricao });
}

async function criarRecorrencia(
  page: Page,
  opts: { descricao: string; valor: string; dia?: string; inicio?: string },
) {
  await page.getByRole("button", { name: "Nova recorrência" }).click();
  await page.getByLabel("Descrição").fill(opts.descricao);
  await page.getByLabel("Valor").fill(opts.valor);
  if (opts.dia) await page.getByLabel("Dia").fill(opts.dia);
  if (opts.inicio) await page.getByLabel("Início").fill(opts.inicio);
  await page.getByRole("button", { name: "Criar recorrência" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linhaDe(page, opts.descricao)).toBeVisible();
}

/** Quantos lançamentos a recorrência já materializou, lido do próprio card. */
async function geradosDe(page: Page, descricao: string): Promise<number> {
  const texto = (await linhaDe(page, descricao).textContent()) ?? "";
  return Number(texto.match(/(\d+) lançamento\(s\) gerado\(s\)/)?.[1] ?? -1);
}

test.describe("acesso", () => {
  test("a aba existe e abre", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro");
    await page.getByRole("link", { name: "Recorrências" }).click();
    await expect(page).toHaveURL(/\/financeiro\/recorrencias$/);
    await expect(page.getByRole("button", { name: "Nova recorrência" })).toBeVisible();
  });
});

test.describe("geração", () => {
  test("criar já materializa os lançamentos do horizonte", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/recorrencias");

    const descricao = unico("Mensalidade e2e");
    await criarRecorrencia(page, { descricao, valor: "500,00", dia: "10" });

    // Horizonte de 3 meses => 4 ocorrências (mês corrente + 3).
    await expect.poll(() => geradosDe(page, descricao)).toBeGreaterThanOrEqual(3);
  });

  test("gerar TRÊS vezes seguidas não duplica", async ({ page }) => {
    /*
     * O teste que o ERP de origem nao passaria. La cada clique criava um
     * conjunto completo novo; aqui o segundo e o terceiro clique nao criam
     * nada, e a mensagem diz isso em vez de anunciar "geradas".
     */
    await login(page);
    await page.goto("/financeiro/recorrencias");

    const descricao = unico("Idempotente e2e");
    await criarRecorrencia(page, { descricao, valor: "100,00", dia: "5" });
    const depoisDeCriar = await geradosDe(page, descricao);
    expect(depoisDeCriar).toBeGreaterThan(0);

    for (let i = 0; i < 3; i++) {
      await linhaDe(page, descricao).getByRole("button", { name: "Gerar" }).click();
      await expect(page.getByText(/Nada a gerar|lançamento/).first()).toBeVisible();
    }

    await page.reload();
    expect(await geradosDe(page, descricao)).toBe(depoisDeCriar);
  });

  test("as ocorrências aparecem como lançamentos de verdade", async ({ page }) => {
    // Materializar em vez de expandir na leitura e o que faz cada ocorrencia
    // ter baixa, comprovante e historico proprios.
    await login(page);
    await page.goto("/financeiro/recorrencias");

    const descricao = unico("Vira lançamento e2e");
    await criarRecorrencia(page, { descricao, valor: "77,00", dia: "15" });

    await page.goto("/financeiro");
    await page.getByLabel("Buscar lançamento").fill(descricao);
    await expect(linhaDe(page, descricao).first()).toBeVisible();
    // E da pra dar baixa numa delas — o que o modelo de override da origem
    // nao consegue guardar por ocorrencia.
    await expect(linhaDe(page, descricao).first().getByRole("button", { name: "Dar baixa" })).toBeVisible();
  });
});

test.describe("pausar", () => {
  test("pausada para de gerar, mas o que já existe fica", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/recorrencias");

    const descricao = unico("Pausada e2e");
    await criarRecorrencia(page, { descricao, valor: "30,00", dia: "20" });
    const antes = await geradosDe(page, descricao);

    await linhaDe(page, descricao).getByRole("button", { name: "Pausar" }).click();
    await expect(linhaDe(page, descricao).getByRole("button", { name: "Reativar" })).toBeVisible();

    await linhaDe(page, descricao).getByRole("button", { name: "Gerar" }).click();
    await page.reload();
    // Nao gerou mais nada — e nao apagou o que ja tinha: sao contas reais.
    expect(await geradosDe(page, descricao)).toBe(antes);
  });
});

test.describe("dia 31", () => {
  test("a prévia mostra o dia caindo em fevereiro e VOLTANDO em março", async ({ page }) => {
    /*
     * O bug documentado da origem: somando "+1 mes" a serie encolhe
     * permanentemente (31/07 -> 31/08 -> 30/09 -> ... -> 28/02 -> 28/03).
     * Aqui cada vencimento e recalculado do dia guardado, entao ele volta.
     */
    await login(page);
    await page.goto("/financeiro/recorrencias");

    await page.getByRole("button", { name: "Nova recorrência" }).click();
    await page.getByLabel("Descrição").fill("Prévia dia 31");
    await page.getByLabel("Valor").fill("10,00");
    await page.getByLabel("Dia").fill("31");
    await page.getByLabel("Início").fill("2026-01-31");

    const previa = page.getByText(/Próximos vencimentos/).locator("..");
    await expect(previa).toContainText("31/01/2026");
    await expect(previa).toContainText("28/02/2026");
    await expect(previa).toContainText("31/03/2026"); // voltou
    await expect(page.getByText(/volta ao dia 31 no mês seguinte/)).toBeVisible();
  });
});
