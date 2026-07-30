import { test, expect, type Page } from "@playwright/test";

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };
const GESTOR = { email: "e2e-gestor@isphub.test", senha: "e2e-senha-123" };
const MOCK_SGP = "http://localhost:4569";

async function login(page: Page, creds: { email: string; senha: string }) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(creds.email);
  await page.getByPlaceholder("••••••••").fill(creds.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
}

test.describe("login por papel", () => {
  test("admin ve o atalho de Administração e consegue acessar /admin", async ({ page }) => {
    await login(page, ADMIN);
    await expect(page.getByRole("link", { name: "Administração" })).toBeVisible();

    await page.getByRole("link", { name: "Administração" }).click();
    await expect(page).toHaveURL("/admin");
    await expect(page.getByRole("heading", { name: "Provedores" })).toBeVisible();
  });

  test("gestor nao ve o atalho de Administração e e bloqueado em /admin", async ({ page }) => {
    await login(page, GESTOR);
    await expect(page.getByRole("link", { name: "Administração" })).toHaveCount(0);

    await page.goto("/admin");
    await expect(page.getByText("Voce nao tem permissao para acessar esta pagina.")).toBeVisible();
  });
});

test("cadastro de provedor", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/admin");

  const nomeUnico = `Provedor Teste ${Date.now()}`;
  await page.getByRole("button", { name: "Novo provedor" }).click();
  await page.getByPlaceholder("Ex: Provedor Norte Telecom").fill(nomeUnico);
  await page.getByRole("button", { name: "Selecionar cor #22c55e" }).click();
  await page.getByRole("button", { name: "Criar provedor" }).click();

  await expect(page.getByText("Provedor criado")).toBeVisible();
  await expect(page.getByRole("heading", { name: nomeUnico })).toBeVisible();
});

/**
 * Ficha do SGP na tela.
 *
 * Roda ANTES do teste de despacho de proposito: aquele CONCLUI a OS fixture, e
 * OS concluida sai do grupo "abertos" da fila — o card deixa de existir. Nao existia teste ponta a ponta disto, e foi por isso
 * que "O SGP nao devolveu dados desta OS" chegou ao usuario sem ninguem notar:
 * o mock nao implementava as rotas da ficha, entao o ambiente local mostrava a
 * mensagem de vazio em toda OS e isso parecia normal.
 */
test("ficha do SGP mostra cliente, PPPoE e conexao no detalhe da OS", async ({ page }) => {
  await login(page, ADMIN);
  // Mesmo caminho do teste de despacho: escopa ao provedor semeado e abre o
  // card (que e um <div role="button">, ver a nota la).
  await page.locator("aside").getByRole("button", { name: /E2E Provider/ }).click();
  const card = page.getByText("Cliente E2E").locator("xpath=ancestor::*[@role='button'][1]");
  await expect(card).toBeVisible();
  await card.click();

  const dialog = page.getByRole("dialog");

  // Aba Detalhes: quem e o cliente. Nome vindo do CADASTRO — diferente do
  // `cliente_nome` da OS de proposito, pra provar de qual fonte veio.
  await expect(dialog.getByText("ASSINANTE CADASTRO E2E")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("12345678900")).toBeVisible();
  // Dados de conexao NAO ficam mais aqui — moraram na aba Conexão.
  await expect(dialog.getByText("Acesso PPPoE")).toHaveCount(0);

  // Aba Conexão: plano, sinal, OLT e PPPoE.
  await dialog.getByRole("tab", { name: "Conexão" }).click();
  await expect(dialog.getByText("Acesso PPPoE")).toBeVisible();
  await expect(dialog.getByText("pppoe-e2e")).toBeVisible();
  await expect(dialog.getByText("FIBRA 500MB")).toBeVisible();
  await expect(dialog.getByText(/RX -21[.,]5 dBm/)).toBeVisible();
  await expect(dialog.getByText("OLT-E2E")).toBeVisible();
  // A senha nasce mascarada.
  await expect(dialog.getByText("senha-e2e")).toHaveCount(0);

  // E a mensagem de "nao devolveu dados" NAO pode aparecer quando ha dados.
  await expect(dialog.getByText(/não devolveu dados desta OS/)).toHaveCount(0);
});

test("fluxo despacho -> status: marcar a caminho e concluir uma OS, refletindo no SGP", async ({
  page,
  request,
}) => {
  // Zera o log do SGP fixture para isolar as chamadas feitas por este teste.
  await request.post(`${MOCK_SGP}/_test/reset`);

  await login(page, ADMIN);

  // Escopa a fila ao provedor semeado pelo global-setup (faceta de provedor na
  // sidebar — restrita ao <aside> pra não colidir com o badge do provedor no
  // próprio card) e abre a OS fixture.
  await page.locator("aside").getByRole("button", { name: /E2E Provider/ }).click();
  // O card é um <div role="button"> (tem links/botões internos — ligar,
  // WhatsApp, copiar —, e interativo-dentro-de-<button> é DOM inválido), por
  // isso o ancestor casa por @role='button', não pela tag <button>.
  const card = page.getByText("Cliente E2E").locator("xpath=ancestor::*[@role='button'][1]");
  await expect(card).toBeVisible();
  await card.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Cliente E2E")).toBeVisible();

  const statusBadge = dialog.getByTestId("status-badge");

  // 1) Despacho: marcar a caminho.
  await dialog.getByRole("button", { name: "Marcar a caminho" }).click();
  await expect(statusBadge).toHaveText("A caminho");

  // 2) Mudar status para concluida.
  await dialog.getByRole("combobox").first().selectOption({ label: "Concluida" });
  await dialog.getByRole("button", { name: "Atualizar status" }).click();
  await expect(statusBadge).toHaveText("Concluida");

  // Confirma que as duas acoes de fato chegaram no SGP (write-back real, nao so local).
  const log = await (await request.get(`${MOCK_SGP}/_test/log`)).json();
  expect(log.some((e: any) => e.acao === "acaminho" && e.osId === "e2e-os-1")).toBe(true);
  // os_status vai como número no corpo JSON (updateOsStatus manda JSON, não
  // form) — o mock loga o valor cru, então é 1 (número), não "1".
  expect(log.some((e: any) => e.acao === "status" && e.osId === "e2e-os-1" && e.osStatus === 1)).toBe(true);
});

test("OS sem tipo mapeado continua na fila principal (regressao do recorte interna/externa)", async ({ page }) => {
  // O recorte que separa Painel (interna) de Retiradas (externa) navega por
  // OS -> TipoOs -> Categoria. Uma OS sem tipoOsId não tem como saber se é de
  // equipe externa — o whereEquipeOs("interna") tem que continuar incluindo
  // esse caso, senão ela some do Painel sem nenhum aviso.
  await login(page, ADMIN);
  await expect(page.getByText("Cliente Sem Tipo")).toBeVisible();
});
