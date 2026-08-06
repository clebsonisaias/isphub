import { expect, test, type Page } from "@playwright/test";

/**
 * ACABAMENTO DO FINANCEIRO — o que existia na API e nao tinha tela.
 *
 * Cada caso aqui corresponde a algo que o usuario NAO conseguia fazer, embora
 * a rota existisse desde a primeira fatia: corrigir um valor digitado errado,
 * cancelar, ver quem deu baixa, anexar comprovante e alcancar o que passa de
 * 200 lancamentos.
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

async function criar(page: Page, descricao: string, valor: string) {
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  await page.getByLabel("Descrição").fill(descricao);
  await page.getByLabel("Valor").fill(valor);
  await page.getByRole("button", { name: "Criar lançamento" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linhaDe(page, descricao)).toBeVisible();
}

/** Abre o detalhe clicando na descricao (que e um botao, nao o card inteiro). */
async function abrirDetalhe(page: Page, descricao: string) {
  await linhaDe(page, descricao).getByRole("button", { name: descricao }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("editar", () => {
  test("corrigir um valor digitado errado", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro");

    const descricao = unico("Errado");
    await criar(page, descricao, "1500,00");
    await expect(linhaDe(page, descricao).getByText("R$ 1.500,00")).toBeVisible();

    await abrirDetalhe(page, descricao);
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Valor").fill("150,00");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect(linhaDe(page, descricao).getByText("R$ 150,00")).toBeVisible();
  });

  test("o tipo fica travado na edição", async ({ page }) => {
    // Virar receita em despesa mudaria o sinal de tudo que ja foi contado em
    // relatorio. Quem errou o tipo cancela e lanca de novo.
    await login(page);
    await page.goto("/financeiro");

    const descricao = unico("Tipo travado");
    await criar(page, descricao, "10,00");
    await abrirDetalhe(page, descricao);
    await page.getByRole("button", { name: "Editar" }).click();

    await expect(page.getByLabel("Tipo", { exact: true })).toBeDisabled();
  });
});

test.describe("cancelar", () => {
  test("cancela com motivo e o lançamento sai do fluxo sem sumir", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro");

    const descricao = unico("A cancelar");
    await criar(page, descricao, "80,00");

    await abrirDetalhe(page, descricao);
    await page.getByRole("button", { name: "Cancelar lançamento" }).click();
    await page.getByLabel(/Motivo do cancelamento/).fill("Lançado em duplicidade");
    await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Continua existindo, com a situacao trocada — nao foi apagado.
    await page.getByRole("button", { name: "Cancelados" }).click();
    await expect(linhaDe(page, descricao).getByText("Cancelado")).toBeVisible();
  });
});

test.describe("histórico", () => {
  test("mostra quem criou e quem deu baixa", async ({ page }) => {
    /*
     * O evento era gravado desde a primeira fatia e nao tinha como ser visto —
     * dado gravado e invisivel e, na hora da duvida, o mesmo que nao existir.
     */
    await login(page);
    await page.goto("/financeiro");

    const descricao = unico("Com histórico");
    await criar(page, descricao, "40,00");

    await linhaDe(page, descricao).getByRole("button", { name: "Dar baixa" }).click();
    await page.getByRole("button", { name: "Confirmar baixa" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await abrirDetalhe(page, descricao);
    const dialogo = page.getByRole("dialog");
    await expect(dialogo.getByText("Criado")).toBeVisible();
    await expect(dialogo.getByText("Baixa registrada")).toBeVisible();
    await expect(dialogo.getByText(/E2E Admin/).first()).toBeVisible();
  });
});

test.describe("comprovante", () => {
  test("anexa um PDF e ele passa a poder ser aberto", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro");

    const descricao = unico("Com comprovante");
    await criar(page, descricao, "60,00");
    await abrirDetalhe(page, descricao);

    await expect(page.getByRole("button", { name: "Anexar" })).toBeVisible();
    // PDF minimo valido — o servidor so confere mime e tamanho.
    await page.locator('input[type="file"]').setInputFiles({
      name: "recibo.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });

    await expect(page.getByRole("button", { name: /recibo\.pdf/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remover" })).toBeVisible();
  });
});

test.describe("paginação", () => {
  test("o botão de carregar mais só aparece quando há mais", async ({ page }) => {
    /*
     * O servidor devolve no maximo 200 por vez. A tela chegava a escrever
     * "mostrando 200" de um total maior e nao oferecia caminho pro resto — em
     * producao o sintoma seria "sumiram lancamentos".
     */
    await login(page);
    await page.goto("/financeiro");
    await expect(page.getByText(/lançamento/).first()).toBeVisible();

    // Com a base de teste pequena, o certo e o botao NAO existir.
    await expect(page.getByRole("button", { name: /Carregar mais/ })).toHaveCount(0);
  });
});

test.describe("filtros", () => {
  test("recorta por período de vencimento", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro");

    const antigo = unico("Antigo");
    await page.getByRole("button", { name: "Novo lançamento" }).click();
    await page.getByLabel("Descrição").fill(antigo);
    await page.getByLabel("Valor").fill("10,00");
    await page.getByLabel("Vencimento", { exact: true }).fill("2020-03-15");
    await page.getByRole("button", { name: "Criar lançamento" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Recorte que NAO contem o lancamento antigo.
    await page.getByLabel("Vencimento de").fill("2026-01-01");
    await expect.poll(() => linhaDe(page, antigo).count()).toBe(0);

    // Recorte que contem.
    await page.getByLabel("Vencimento de").fill("2020-01-01");
    await page.getByLabel("até").fill("2020-12-31");
    await expect(linhaDe(page, antigo)).toBeVisible();
  });

  test("limpar filtros volta a lista inteira", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro");

    await page.getByLabel("Vencimento de").fill("2019-01-01");
    await page.getByLabel("até").fill("2019-12-31");
    await expect(page.getByText("Nenhum lançamento neste recorte.")).toBeVisible();

    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page.getByText("Nenhum lançamento neste recorte.")).toHaveCount(0);
  });
});

test.describe("categorias", () => {
  test("renomear e desativar", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/relatorios");

    const nome = unico("Cat renomear");
    await page.getByLabel("Nova categoria").fill(nome);
    await page.getByLabel("Tipo", { exact: true }).selectOption("despesa");
    await page.getByRole("button", { name: "Criar" }).click();
    await expect(page.getByLabel(`Nome da categoria ${nome}`)).toBeVisible();

    // Renomeia: o PATCH so dispara no blur, nao a cada tecla.
    const novo = `${nome} corrigido`;
    const campo = page.getByLabel(`Nome da categoria ${nome}`);
    await campo.fill(novo);
    await campo.blur();
    await expect(page.getByLabel(`Nome da categoria ${novo}`)).toBeVisible();
  });
});
