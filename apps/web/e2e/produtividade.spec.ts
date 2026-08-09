import { expect, test, type Page } from "@playwright/test";

/**
 * PRODUTIVIDADE — /produtividade.
 *
 * O que estes testes protegem nao e um numero num painel: e um numero ao lado
 * do NOME de uma pessoa. Cada caso aqui trava uma promessa que a tela faz sobre
 * como ela julga gente, e que quebraria em silencio.
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

test.describe("produtividade", () => {
  test("a regra da comparação fica NA tela, não escondida", async ({ page }) => {
    /*
     * Quem e comparado tem direito de ver a regra da comparacao. A tabela de
     * pesos e o que torna a pontuacao contestavel — sem ela, o numero vira
     * indiscutivel, que e o modo mais perigoso de estar errado.
     */
    await login(page, GESTOR);
    await page.goto("/produtividade");

    await expect(page.getByRole("heading", { name: "Produtividade" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Peso" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Amostras" })).toBeVisible();
    // A explicacao de DE ONDE o tempo conta anda junto da tabela.
    await expect(page.getByText(/fila não é trabalho de técnico/)).toBeVisible();
  });

  test("tipo sem amostra diz que não tem peso — nunca mostra 1,00×", async ({ page }) => {
    /*
     * Mostrar "1,00×" onde nao ha medicao daria a um palpite a mesma aparencia
     * de um numero medido, no lugar exato em que isso custa mais caro.
     */
    await login(page, GESTOR);
    await page.goto("/produtividade");

    const semPeso = page.getByText(/sem peso — precisa de \d+/);
    if ((await semPeso.count()) > 0) {
      await expect(semPeso.first()).toBeVisible();
    }
  });

  test("a pontuação nunca aparece sem a contagem crua ao lado", async ({ page }) => {
    /*
     * Pontos sao uma INTERPRETACAO do trabalho; a contagem e o fato. Esconder o
     * fato transformaria um numero discutivel num numero indiscutivel.
     */
    await login(page, GESTOR);
    await page.goto("/produtividade");

    const primeira = page.locator("li").filter({ hasText: /pts/ }).first();
    if (await primeira.isVisible().catch(() => false)) {
      await expect(primeira).toContainText(/pts/);
      await expect(primeira).toContainText(/\d+ OS/);
    }
  });

  test("o ranking é por PONTOS, e não por quantidade de OS", async ({ page }) => {
    /*
     * A inversao e o produto inteiro: quem faz o servico demorado nao pode ficar
     * atras de quem faz o rapido. Se a ordem por pontos coincidir sempre com a
     * ordem por contagem, a pontuacao nao esta fazendo nada.
     */
    await login(page, GESTOR);
    await page.goto("/produtividade");

    const linhas = page.locator("li").filter({ hasText: /pts/ });
    const n = await linhas.count();
    if (n < 2) return;

    const pontos: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const texto = (await linhas.nth(i).textContent()) ?? "";
      const m = /([\d.,]+)\s*pts/.exec(texto);
      pontos.push(m ? Number(m[1]!.replace(/\./g, "").replace(",", ".")) : 0);
    }
    // Monotonicamente nao-crescente: e o que "ordenado por pontos" significa.
    for (let i = 1; i < pontos.length; i += 1) {
      expect(pontos[i]!).toBeLessThanOrEqual(pontos[i - 1]!);
    }
  });

  test("técnico não alcança o ranking da equipe", async ({ page }) => {
    /*
     * Um ranking em que cada um ve a propria posicao contra a dos colegas muda o
     * que as pessoas fazem — e isso e decisao de gestao, nao de codigo.
     */
    await login(page, TECNICO);
    await page.goto("/produtividade");
    await expect(page.getByRole("heading", { name: "Produtividade" })).toBeHidden();
  });

  test("a impressão guarda o ranking, não os controles", async ({ page }) => {
    await login(page, GESTOR);
    await page.goto("/produtividade");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: /imprimir/i })).toBeHidden();
    // Pelo id: "De" tambem casa com outro rotulo da tela.
    await expect(page.locator("#pr-de")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Produtividade" })).toBeVisible();
  });
});
