import { expect, test, type Page } from "@playwright/test";

/**
 * BI DA FROTA — /frota/bi.
 *
 * Este spec nao confere "a tela abriu". Ele fixa as quatro coisas que, quando
 * quebraram, NAO deram erro nenhum: o painel continuou fechando, so que com o
 * numero errado — que e o modo de falhar mais caro que um BI tem.
 *
 * Roda contra um banco que persiste e pode estar vazio de frota. Por isso toda
 * assercao aqui e sobre COERENCIA INTERNA (o mesmo numero em dois lugares, a
 * data do eixo contra a data do filtro), e nao sobre valor absoluto.
 */

const GESTOR = { email: "e2e-gestor@isphub.test", senha: "e2e-senha-123" };
const TECNICO = { email: "e2e-tecnico@isphub.test", senha: "e2e-senha-123" };

async function login(page: Page, quem: { email: string; senha: string }) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(quem.email);
  await page.getByLabel("Senha", { exact: true }).fill(quem.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

/** "21.036 km" -> 21036. So no TESTE. */
function numero(texto: string): number {
  return Number(texto.replace(/[^\d]/g, "") || 0);
}

test.describe("BI da frota", () => {
  test("o total do gráfico é o MESMO número do KPI", async ({ page }) => {
    /*
     * A regressao do primeiro bug real desta tela: o rodape somava as colunas no
     * navegador, e cada coluna e um quilometro arredondado. A soma de noventa
     * arredondamentos divergia do KPI em 4 km — pouco o bastante pra ninguem
     * notar, e o suficiente pra um gestor que notasse parar de confiar na tela
     * inteira. O total passou a vir do servidor.
     */
    await login(page, GESTOR);
    await page.goto("/frota/bi");

    const kpi = page.locator("p", { hasText: /^RODADO POR GPS$/i }).locator("..").locator("p").nth(1);
    await expect(kpi).toBeVisible();
    const kmKpi = numero((await kpi.textContent()) ?? "");

    const rodape = page.getByText(/km no período/);
    if (kmKpi === 0) {
      // Sem viagem no periodo o grafico diz isso em vez de desenhar zeros.
      await expect(page.getByText(/Nenhuma viagem registrada por rastreador/)).toBeVisible();
      return;
    }
    await expect(rodape).toBeVisible();
    expect(numero((await rodape.textContent()) ?? "")).toBe(kmKpi);
  });

  test("o eixo do gráfico começa na data que o filtro mostra", async ({ page }) => {
    /*
     * A regressao do segundo bug: `de=2026-05-12` virava `T00:00:00Z`, que em
     * Natal e 21h do dia 11 — e a serie, agrupada pelo dia brasileiro, rotulava
     * a primeira coluna como 11/05 enquanto o campo logo acima dizia 12/05.
     * Nenhum erro; so um dia de diferenca que ninguem consegue explicar.
     */
    await login(page, GESTOR);
    await page.goto("/frota/bi");

    await page.getByLabel("De").fill("2026-05-12");
    await page.getByLabel("Até").fill("2026-08-09");

    const primeiroDia = page.locator("span", { hasText: /^\d{2}\/\d{2}$/ }).first();
    // So ha eixo se houver serie; sem rastreador no periodo a tela diz outra coisa.
    if (await primeiroDia.isVisible().catch(() => false)) {
      await expect(primeiroDia).toHaveText("12/05");
    }
  });

  test("veículo sem rastreador diz que não tem — nunca 0 km", async ({ page }) => {
    /*
     * A regra que o tipo `Rastreamento` existe para impor: metade da frota nao
     * tem aparelho, e "0 km" ali le como "o carro nao rodou", que e uma
     * afirmacao que ninguem pode fazer.
     */
    await login(page, GESTOR);
    await page.goto("/frota/bi");

    const cobertura = page.locator("p", { hasText: /^COBERTURA DO RASTREADOR$/i }).locator("..");
    await expect(cobertura).toBeVisible();
    const texto = (await cobertura.textContent()) ?? "";
    const [com, total] = texto.match(/(\d+)\s+de\s+(\d+)/)?.slice(1).map(Number) ?? [0, 0];
    expect(com).toBeLessThanOrEqual(total);

    if (com < total) {
      await expect(cobertura.getByText(/sem rastreador/)).toBeVisible();
      // A coluna "Pelo rastreador" fala, e nao mostra um zero de consolo.
      await expect(page.getByRole("cell", { name: "sem rastreador" }).first()).toBeVisible();
    }
  });

  test("todo gráfico tem a tabela para quem não consegue lê-lo", async ({ page }) => {
    // Doutrina da casa: barra colorida sozinha e informacao so na cor.
    await login(page, GESTOR);
    await page.goto("/frota/bi");
    const tabela = page.getByText("Ver como tabela");
    if (await tabela.first().isVisible().catch(() => false)) {
      await tabela.first().click();
      await expect(page.getByRole("columnheader", { name: "Dia" })).toBeVisible();
    }
  });

  test("a impressão guarda os números, não os controles", async ({ page }) => {
    await login(page, GESTOR);
    await page.goto("/frota/bi");
    await expect(page.getByRole("button", { name: /imprimir/i })).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: /imprimir/i })).toBeHidden();
    await expect(page.getByLabel("De")).toBeHidden();
    // O conteudo continua: e ele que vai pro papel.
    await expect(page.getByRole("heading", { name: "Frota em números" })).toBeVisible();
  });

  test("técnico não alcança o BI", async ({ page }) => {
    /*
     * A guarda de papel tem tres camadas (menu, rota, API). Aqui exercitamos a
     * segunda: um TECNICO que digite a URL nao pode ver quanto a frota custou.
     */
    await login(page, TECNICO);
    await page.goto("/frota/bi");
    await expect(page.getByRole("heading", { name: "Frota em números" })).toBeHidden();
  });
});
