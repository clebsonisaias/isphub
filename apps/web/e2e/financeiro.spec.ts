import { expect, test, type Page } from "@playwright/test";

/**
 * FINANCEIRO DA HUBISP — o dinheiro da propria empresa.
 *
 * Dois eixos sao vigiados aqui, e nenhum dos dois e cosmetico:
 *
 * 1. CONFINAMENTO. A tabela tem quanto cada provedor paga a hub. Um provedor
 *    logado que alcance esta tela ve o preco combinado com os concorrentes
 *    dele. Sao tres camadas de guarda (modulo, nav, rota da API) e o teste
 *    cobra as tres — uma sozinha nao basta, porque `rolesPermitidos` do modulo
 *    e editavel em /admin/modulos.
 *
 * 2. O TOTAL E DO SERVIDOR. O cabecalho nao pode ser a soma do que coube na
 *    tela: seria o total da PAGINA se passando por total geral, com aritmetica
 *    de float por cima. O teste confere que o numero muda de acordo com o
 *    banco, nao com a lista renderizada.
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

/** Descricao unica por execucao — a suite roda contra um banco que persiste. */
function descricaoUnica(prefixo: string) {
  return `${prefixo} ${Date.now()}`;
}

/** O "a receber em aberto" do cabecalho, em centavos (numero so no TESTE). */
async function aReceberEmAberto(page: Page): Promise<number> {
  const texto = await page
    // Ancora no rotulo EXATO e pega o irmao seguinte: um `hasText` no `div`
    // pai casaria com o texto do rotulo + do valor juntos e nunca bateria.
    .getByText("A receber em aberto", { exact: true })
    .locator("xpath=following-sibling::p[1]")
    .textContent();
  return centavos(texto ?? "");
}

/** "R$ 1.234,56" -> 123456. Serve so pra ASSERCAO; o app nunca faz isso. */
function centavos(formatado: string): number {
  const limpo = formatado.replace(/[^\d,]/g, "").replace(",", "");
  return Number(limpo || 0);
}

async function criarLancamento(page: Page, descricao: string, valor: string) {
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  await page.getByLabel("Descrição").fill(descricao);
  await page.getByLabel("Valor").fill(valor);
  await page.getByRole("button", { name: "Criar lançamento" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linhaDe(page, descricao)).toBeVisible();
}

/**
 * A linha de UM lancamento. Ancorar aqui e obrigatorio, nao estilistico: o
 * banco de teste persiste entre execucoes, entao um `getByText("R$ 1.234,56")`
 * solto casa tambem com a sobra da rodada anterior e o teste passa (ou falha)
 * por motivo errado.
 */
function linhaDe(page: Page, descricao: string) {
  return page.getByRole("listitem").filter({ hasText: descricao });
}

test.describe("acesso", () => {
  test("admin alcanca o Financeiro pela navegação", async ({ page }) => {
    await login(page, ADMIN);

    /*
     * O item pode estar na linha do cabecalho OU dentro do menu "Mais" — com
     * nove itens a 1280px ele cai no excesso, e isso e o mecanismo funcionando,
     * nao defeito (ver useQuantosCabem em AppShell.tsx). Exigir que esteja
     * SEMPRE na linha transformaria uma decisao de layout em teste quebrado a
     * cada modulo novo. O que importa e chegar la.
     */
    const naLinha = page.getByRole("link", { name: "Financeiro" });
    if (!(await naLinha.isVisible())) {
      await page.getByRole("button", { name: /Mais/ }).click();
    }
    await expect(page.getByRole("link", { name: "Financeiro" })).toBeVisible();
    await page.getByRole("link", { name: "Financeiro" }).click();

    await expect(page).toHaveURL(/\/financeiro$/);
    await expect(page.getByRole("heading", { name: "Financeiro" })).toBeVisible();
  });

  test("gestor nao ve o item de nav nem entra na rota", async ({ page }) => {
    // Gestor enxerga a operacao inteira, mas quanto cada provedor paga a hub
    // nao e operacao — e contrato comercial.
    await login(page, GESTOR);
    // Nem na linha nem dentro do "Mais" — `toHaveCount(0)` varre o documento
    // inteiro, entao cobre os dois lugares.
    await expect(page.getByRole("link", { name: "Financeiro" })).toHaveCount(0);

    await page.goto("/financeiro");
    await expect(page.getByRole("heading", { name: "Financeiro" })).toHaveCount(0);
  });

  test("a API recusa quem nao e admin, mesmo sem passar pela tela", async ({ page }) => {
    // A guarda da rota da API e independente da nav e do motor de modulos:
    // alguem pode ligar o modulo pra outro papel em /admin/modulos sem
    // perceber o que isso expoe.
    await login(page, GESTOR);
    const status = await page.evaluate(async () => {
      const r = await fetch("http://localhost:4000/financeiro/lancamentos", {
        headers: { Authorization: `Bearer ${localStorage.getItem("isphub_token")}` },
      });
      return r.status;
    });
    expect(status).toBe(403);
  });
});

test.describe("lancamento e baixa", () => {
  test("cria um lancamento a receber e ele aparece na lista", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/financeiro");

    const descricao = descricaoUnica("Mensalidade e2e");
    await criarLancamento(page, descricao, "1.234,56");

    // O valor tem que sair formatado em pt-BR a partir da STRING que veio da
    // API — se em algum ponto virou number, "1234.56" nao volta exato.
    const linha = linhaDe(page, descricao);
    await expect(linha.getByText("R$ 1.234,56")).toBeVisible();
    await expect(linha.getByText("Em aberto")).toBeVisible();
  });

  test("o total do cabecalho e do servidor — muda com o banco, nao com a tela", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/financeiro");
    await expect(page.getByText("A receber em aberto")).toBeVisible();

    const antes = await aReceberEmAberto(page);
    await criarLancamento(page, descricaoUnica("Total e2e"), "100,00");

    await expect.poll(async () => aReceberEmAberto(page)).toBe(antes + 10_000);
  });

  test("dar baixa tira do 'em aberto' e o estorno devolve", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/financeiro");

    const descricao = descricaoUnica("Baixa e2e");
    await criarLancamento(page, descricao, "50,00");
    const comLancamento = await aReceberEmAberto(page);

    await linhaDe(page, descricao).getByRole("button", { name: "Dar baixa" }).click();
    await page.getByRole("button", { name: "Confirmar baixa" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Pago sai do "em aberto": e o proprio significado do numero.
    await expect.poll(async () => aReceberEmAberto(page)).toBe(comLancamento - 5_000);
    await expect(linhaDe(page, descricao).getByText("Pago")).toBeVisible();

    await linhaDe(page, descricao).getByRole("button", { name: "Estornar" }).click();
    await expect.poll(async () => aReceberEmAberto(page)).toBe(comLancamento);
  });

  test("nao da pra criar lancamento de valor invalido", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/financeiro");

    await page.getByRole("button", { name: "Novo lançamento" }).click();
    await page.getByLabel("Descrição").fill("Invalido");
    await page.getByLabel("Valor").fill("abc");

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar lançamento" })).toBeDisabled();
  });

  test("zero nao e lancamento", async ({ page }) => {
    // Lancamento de R$ 0 e ruido: aparece na lista, entra na contagem e nao
    // significa nada.
    await login(page, ADMIN);
    await page.goto("/financeiro");

    await page.getByRole("button", { name: "Novo lançamento" }).click();
    await page.getByLabel("Descrição").fill("Zerado");
    await page.getByLabel("Valor").fill("0,00");

    await expect(page.getByRole("button", { name: "Criar lançamento" })).toBeDisabled();
  });
});

test.describe("situacao derivada", () => {
  test("vencido aparece como Atrasado sem existir coluna pra isso", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/financeiro");

    const descricao = descricaoUnica("Vencido e2e");
    await page.getByRole("button", { name: "Novo lançamento" }).click();
    await page.getByLabel("Descrição").fill(descricao);
    await page.getByLabel("Valor").fill("10,00");
    await page.getByLabel("Vencimento", { exact: true }).fill("2020-01-01");
    await page.getByRole("button", { name: "Criar lançamento" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Nasce `pendente` no banco e e EXIBIDO como atrasado — nenhum job virou
    // linha nenhuma pra isso acontecer.
    await expect(linhaDe(page, descricao).getByText("Atrasado", { exact: true })).toBeVisible();

    // E o chip de atrasados encontra o mesmo lancamento.
    await page.getByRole("button", { name: "Atrasados" }).click();
    await expect(linhaDe(page, descricao)).toBeVisible();
  });

  test("vencer hoje ainda nao e atraso", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/financeiro");

    const descricao = descricaoUnica("Vence hoje e2e");
    await criarLancamento(page, descricao, "10,00"); // vencimento padrao = hoje

    const linha = linhaDe(page, descricao);
    await expect(linha.getByText("Em aberto")).toBeVisible();
    await expect(linha.getByText("Atrasado", { exact: true })).toHaveCount(0);
  });
});
