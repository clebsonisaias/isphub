import { expect, test, type Page } from "@playwright/test";

/**
 * RELATORIOS DO FINANCEIRO — DRE, inadimplencia e evolucao.
 *
 * O caso que importa aqui e o do NAO-CLASSIFICADO. O ERP de origem, cuja
 * documentacao registra o proprio defeito, dobra despesa sem classificacao
 * dentro de "custos variaveis" sem avisar: o demonstrativo fecha e ninguem
 * descobre que parte do numero foi chutada. Este spec exige o contrario —
 * o valor aparece em linha propria, marcado, e SAI do resultado.
 *
 * Como a suite roda contra um banco que persiste, quase toda assercao aqui e
 * sobre DELTA (antes x depois), nunca sobre valor absoluto.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };
const GESTOR = { email: "e2e-gestor@isphub.test", senha: "e2e-senha-123" };

async function login(page: Page, quem: { email: string; senha: string }) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(quem.email);
  await page.getByLabel("Senha", { exact: true }).fill(quem.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

function unico(prefixo: string) {
  return `${prefixo} ${Date.now()}`;
}

/** "R$ 1.234,56" -> 123456. So no TESTE; o app nunca converte dinheiro. */
function centavos(formatado: string): number {
  const negativo = formatado.trim().startsWith("-");
  const limpo = formatado.replace(/[^\d,]/g, "").replace(",", "");
  return (negativo ? -1 : 1) * Number(limpo || 0);
}

/** Valor de uma linha do DRE, pelo rotulo. */
async function linhaDre(page: Page, rotulo: string): Promise<number> {
  const linha = page.getByRole("row").filter({ hasText: rotulo });
  const celulas = linha.getByRole("cell");
  return centavos((await celulas.nth(1).textContent()) ?? "0");
}

/** Cria um lancamento pela tela de lancamentos. */
async function criarLancamento(
  page: Page,
  opts: { descricao: string; valor: string; tipo: "receita" | "despesa"; categoria?: string; vencimento?: string },
) {
  await page.goto("/financeiro");
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  // `exact`: "Tipo" tambem casa com o aria-label "Tipo de lançamento" da tablist.
  await page.getByLabel("Tipo", { exact: true }).selectOption(opts.tipo);
  await page.getByLabel("Descrição").fill(opts.descricao);
  await page.getByLabel("Valor").fill(opts.valor);
  if (opts.vencimento) await page.getByLabel("Vencimento", { exact: true }).fill(opts.vencimento);
  // `exact`: o novo filtro da lista tambem se chama "Filtrar por categoria".
  if (opts.categoria) await page.getByLabel("Categoria", { exact: true }).selectOption({ label: opts.categoria });
  await page.getByRole("button", { name: "Criar lançamento" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("acesso", () => {
  test("admin chega nos relatórios pela aba", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/financeiro");

    await page.getByRole("link", { name: "Relatórios" }).click();

    await expect(page).toHaveURL(/\/financeiro\/relatorios$/);
    await expect(page.getByRole("heading", { name: "Demonstrativo de resultado" })).toBeVisible();
  });

  test("gestor nao alcanca os relatórios", async ({ page }) => {
    await login(page, GESTOR);
    await page.goto("/financeiro/relatorios");
    await expect(page.getByRole("heading", { name: "Demonstrativo de resultado" })).toHaveCount(0);
  });
});

test.describe("DRE", () => {
  test("uma receita nova entra na receita bruta e no resultado", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/financeiro/relatorios");
    await expect(page.getByRole("heading", { name: "Demonstrativo de resultado" })).toBeVisible();

    const receitaAntes = await linhaDre(page, "Receita bruta");
    const resultadoAntes = await linhaDre(page, "Resultado operacional");

    await criarLancamento(page, { descricao: unico("DRE receita"), valor: "500,00", tipo: "receita" });

    await page.goto("/financeiro/relatorios");
    await expect.poll(() => linhaDre(page, "Receita bruta")).toBe(receitaAntes + 50_000);
    // Receita sem dedução nem custo cai inteira no resultado.
    await expect.poll(() => linhaDre(page, "Resultado operacional")).toBe(resultadoAntes + 50_000);
  });

  test("a cadeia de subtotais fecha na tela", async ({ page }) => {
    // Receita líquida = bruta − deduções; lucro bruto = líquida − variáveis.
    // Se alguém trocar a ordem das linhas, aqui quebra.
    await login(page, ADMIN);
    await page.goto("/financeiro/relatorios");
    await expect(page.getByRole("heading", { name: "Demonstrativo de resultado" })).toBeVisible();

    const bruta = await linhaDre(page, "Receita bruta");
    const deducoes = await linhaDre(page, "Deduções");
    const liquida = await linhaDre(page, "Receita líquida");
    const variaveis = await linhaDre(page, "Custos variáveis");
    const lucro = await linhaDre(page, "Lucro bruto");

    expect(liquida).toBe(bruta - deducoes);
    expect(lucro).toBe(liquida - variaveis);
  });

  test("o regime muda o número — competência conta o não pago, caixa não", async ({ page }) => {
    await login(page, ADMIN);

    // Um lançamento PENDENTE: existe na competência, não existe no caixa.
    await criarLancamento(page, { descricao: unico("Regime e2e"), valor: "700,00", tipo: "receita" });

    await page.goto("/financeiro/relatorios");
    await expect(page.getByRole("heading", { name: "Demonstrativo de resultado" })).toBeVisible();
    const porCompetencia = await linhaDre(page, "Receita bruta");

    await page.getByLabel("Regime").selectOption("caixa");
    await expect.poll(async () => linhaDre(page, "Receita bruta")).toBeLessThanOrEqual(porCompetencia - 70_000);
  });
});

test.describe("o não-classificado não se esconde", () => {
  test("aparece em linha própria, marcado, e sai do resultado", async ({ page }) => {
    await login(page, ADMIN);

    // 1. Categoria de despesa SEM classificação.
    const categoria = unico("e2e cat");
    await page.goto("/financeiro/relatorios");
    await page.getByLabel("Nova categoria").fill(categoria);
    await page.getByLabel("Tipo", { exact: true }).selectOption("despesa");
    await page.getByRole("button", { name: "Criar" }).click();
    // O nome vive no `value` de um input editavel — `getByText` nao alcança.
    await expect(page.getByLabel(`Nome da categoria ${categoria}`)).toBeVisible();

    const resultadoAntes = await linhaDre(page, "Resultado operacional");

    // 2. Uma despesa nela.
    await criarLancamento(page, {
      descricao: unico("Despesa órfã"),
      valor: "300,00",
      tipo: "despesa",
      categoria,
    });

    // 3. O DRE denuncia — e desconta.
    await page.goto("/financeiro/relatorios");
    await expect(page.getByRole("status").filter({ hasText: "sem classificação" })).toBeVisible();
    await expect.poll(() => linhaDre(page, "Sem classificação")).toBeGreaterThanOrEqual(30_000);
    // O valor SAIU do resultado: e a diferenca entre denunciar e so avisar.
    await expect.poll(() => linhaDre(page, "Resultado operacional")).toBe(resultadoAntes - 30_000);
  });

  test("classificar a categoria move o valor para a linha certa", async ({ page }) => {
    await login(page, ADMIN);

    const categoria = unico("e2e cat mov");
    await page.goto("/financeiro/relatorios");
    await page.getByLabel("Nova categoria").fill(categoria);
    await page.getByLabel("Tipo", { exact: true }).selectOption("despesa");
    await page.getByRole("button", { name: "Criar" }).click();
    // O nome vive no `value` de um input editavel — `getByText` nao alcança.
    await expect(page.getByLabel(`Nome da categoria ${categoria}`)).toBeVisible();

    await criarLancamento(page, {
      descricao: unico("Vai virar operacional"),
      valor: "250,00",
      tipo: "despesa",
      categoria,
    });

    await page.goto("/financeiro/relatorios");
    const semClassAntes = await linhaDre(page, "Sem classificação");
    const operacionaisAntes = await linhaDre(page, "Despesas operacionais");
    const resultadoAntes = await linhaDre(page, "Resultado operacional");

    await page
      .getByLabel(`Classificação de ${categoria} no DRE`)
      .selectOption("despesa_operacional");

    // O valor TROCA de linha; o resultado nao muda, porque as duas linhas
    // subtraem. E isso que prova que o nao-classificado ja estava sendo
    // descontado, e nao apenas exibido.
    await expect.poll(() => linhaDre(page, "Despesas operacionais")).toBe(operacionaisAntes + 25_000);
    await expect.poll(() => linhaDre(page, "Sem classificação").catch(() => 0)).toBe(
      Math.max(0, semClassAntes - 25_000),
    );
    await expect.poll(() => linhaDre(page, "Resultado operacional")).toBe(resultadoAntes);
  });
});

test.describe("inadimplência", () => {
  test("um vencido em aberto entra no total e na faixa certa", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/financeiro/relatorios");
    await expect(page.getByRole("heading", { name: "Inadimplência" })).toBeVisible();

    // Vence ha muito tempo: cai na faixa "mais de 90 dias".
    await criarLancamento(page, {
      descricao: unico("Inadimplente e2e"),
      valor: "999,00",
      tipo: "receita",
      vencimento: "2020-01-01",
    });

    await page.goto("/financeiro/relatorios");
    const bloco = page.locator("div").filter({ hasText: /^Total vencido/ }).first();
    await expect(bloco).toBeVisible();
    await expect(page.getByText("mais de 90 dias")).toBeVisible();
  });
});

test.describe("gráficos", () => {
  test("a evolução mensal também vira tabela, para quem não lê a cor", async ({ page }) => {
    // Barra colorida sozinha e informacao so na cor — o pior padrao de
    // acessibilidade em grafico.
    await login(page, ADMIN);
    await page.goto("/financeiro/relatorios");

    await page.getByText("Ver como tabela").click();
    await expect(page.getByRole("columnheader", { name: "Resultado" })).toBeVisible();
  });
});
