import { test, expect, type Page } from "@playwright/test";

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };
const GESTOR = { email: "e2e-gestor@isphub.test", senha: "e2e-senha-123" };
const MOCK_SGP = "http://localhost:4569";
const API = "http://localhost:4000";

async function login(page: Page, creds: { email: string; senha: string }) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(creds.email);
  await page.getByLabel("Senha", { exact: true }).fill(creds.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
}

test.describe("login por papel", () => {
  test("admin ve o atalho de Administração e consegue acessar /admin", async ({ page }) => {
    await login(page, ADMIN);

    /*
     * O item pode estar na LINHA ou dentro de "Mais", conforme a largura e a
     * quantidade de modulos ligados — o cabecalho colapsa o excesso num menu.
     * O que importa aqui e ser ALCANCAVEL, nao em qual dos dois lugares esta.
     */
    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();

    /*
     * `toPass` reavalia o BLOCO inteiro, e e o unico formato que aguenta este
     * cabecalho — ele assenta em ETAPAS, nao numa so:
     *
     *   1. renderiza com os itens que ja se conhece;
     *   2. `/config` chega e a lista de modulos muda (o item de Administração
     *      depende de modulo habilitado — ver AppShell.tsx:42);
     *   3. a medicao de largura roda e colapsa o excesso dentro de "Mais".
     *
     * Um `if` executado uma vez decide sobre um instantâneo que ainda vai
     * mudar: foi o que fez este teste dar falso negativo duas vezes em 07/08,
     * ora com "Mais" ainda inexistente, ora com a lista de itens incompleta.
     */
    const link = page.getByRole("link", { name: "Administração" });
    const mais = page.getByRole("button", { name: /Mais seções/ });
    await expect(async () => {
      if (await mais.isVisible()) await mais.click();
      await expect(link).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    await link.click();
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
  await dialog.getByLabel("Novo status da OS").selectOption({ label: "Concluida" });
  await dialog.getByRole("button", { name: "Atualizar status" }).click();
  await expect(statusBadge).toHaveText("Concluida");

  // Confirma que as duas acoes de fato chegaram no SGP (write-back real, nao so local).
  const log = await (await request.get(`${MOCK_SGP}/_test/log`)).json();
  expect(log.some((e: any) => e.acao === "acaminho" && e.osId === "e2e-os-1")).toBe(true);
  // os_status vai como número no corpo JSON (encerrarOs manda JSON, não
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

/**
 * ATUALIZACAO AO VIVO — o Painel tem que refletir o ERP sem recarregar.
 *
 * Prova de ponta a ponta do que antes era so promessa: a tela era carregada
 * uma vez e so recarregava se alguem agisse numa OS. Aqui a OS nasce no ERP
 * (fixture), o sync roda, e o teste exige que ela apareca na tela SEM nenhum
 * page.reload() — se o SSE nao chegar ou o Painel nao reagir, isto falha.
 */
test("OS criada no ERP aparece no Painel sem recarregar a pagina", async ({ page, request }) => {
  await request.post(`${MOCK_SGP}/_test/reset`);
  await login(page, ADMIN);

  const cliente = `CLIENTE AO VIVO ${Date.now()}`;
  await expect(page.getByText(cliente)).toHaveCount(0);

  // 1) A OS nasce no ERP.
  await request.post(`${MOCK_SGP}/_test/os`, {
    data: {
      os_id: `ao-vivo-${Date.now()}`,
      os_status: 0,
      motivo: "1",
      os_conteudo: "Aberta durante o teste",
      cliente_nome: cliente,
      contrato_id: "1",
      endereco_logradouro: "Rua do Tempo Real",
      endereco_numero: "1",
      endereco_bairro: "Centro",
      endereco_cidade: "Natal",
      endereco_ll: "-5.79,-35.21",
      os_data_agendamento: "2026-12-31 09:00:00",
    },
  });

  // 2) O sync a traz e emite `os-alterada` pra quem esta com a tela aberta.
  const token = await page.evaluate(() => localStorage.getItem("isphub_token"));
  const provedores = await request.get(`${API}/provedores`, { headers: { Authorization: `Bearer ${token}` } });
  const provedor = (await provedores.json()).find((p: { nome: string }) => p.nome === "E2E Provider");
  await request.post(`${API}/provedores/${provedor.id}/sync`, { headers: { Authorization: `Bearer ${token}` } });

  // 3) Sem reload: a tela tem que se virar sozinha.
  await expect(page.getByText(cliente)).toBeVisible({ timeout: 20_000 });
});

/**
 * O SENTIDO INVERSO — o bug relatado de verdade: "fechei a OS no SGP e ela
 * continua aberta aqui, muito alem do ciclo de sync". Causa raiz: a OS sumia
 * das varreduras de aberta, e o codigo antigo perguntava ao SGP "esta OS
 * ainda existe?" — pra uma OS fechada a resposta e "sim, existe" (so nao esta
 * mais aberta), entao nada acontecia, em todo ciclo, pra sempre.
 *
 * Espelha o teste "aparece": nasce uma OS, entra na fila, o SGP fixture marca
 * ela como fechada (`_test/os/:id/status`), o sync roda, e a OS tem que sumir
 * do Painel SEM reload — se a reconciliacao nao rodar, ou a UI nao reagir ao
 * `os-alterada`, isto falha.
 */
test("OS fechada no SGP some do Painel sem recarregar a pagina", async ({ page, request }) => {
  await request.post(`${MOCK_SGP}/_test/reset`);
  await login(page, ADMIN);

  const cliente = `CLIENTE FECHOU ${Date.now()}`;
  const osId = `fecha-${Date.now()}`;
  const token = await page.evaluate(() => localStorage.getItem("isphub_token"));
  const provedores = await request.get(`${API}/provedores`, { headers: { Authorization: `Bearer ${token}` } });
  const provedor = (await provedores.json()).find((p: { nome: string }) => p.nome === "E2E Provider");

  // 1) A OS nasce ABERTA no ERP e o sync a traz pro Painel.
  await request.post(`${MOCK_SGP}/_test/os`, {
    data: {
      os_id: osId,
      os_status: 0,
      motivo: "1",
      os_conteudo: "Sera fechada durante o teste",
      cliente_nome: cliente,
      contrato_id: "1",
      endereco_logradouro: "Rua que Fecha",
      endereco_numero: "1",
      endereco_bairro: "Centro",
      endereco_cidade: "Natal",
      endereco_ll: "-5.79,-35.21",
      os_data_agendamento: "2026-12-31 09:00:00",
    },
  });
  await request.post(`${API}/provedores/${provedor.id}/sync`, { headers: { Authorization: `Bearer ${token}` } });
  await expect(page.getByText(cliente)).toBeVisible({ timeout: 20_000 });

  // 2) Fecha a OS diretamente no "SGP" — nao pelo ISPhub. Simula o tecnico
  // (ou o proprio SGP) encerrando por fora do sistema.
  await request.post(`${MOCK_SGP}/_test/os/${osId}/status`, { data: { os_status: 1 } }); // 1 = Encerrada

  // 3) Novo ciclo de sync: a OS sumiu da varredura de aberta, o sync confirma
  // via obterStatusOs e reconcilia.
  await request.post(`${API}/provedores/${provedor.id}/sync`, { headers: { Authorization: `Bearer ${token}` } });

  // 4) Sem reload: a OS tem que sumir da Fila sozinha.
  await expect(page.getByText(cliente)).toHaveCount(0, { timeout: 20_000 });

  // E reaparece na aba Concluidas, com o status certo — nao cancelada por
  // engano (o SGP disse "Encerrada", nao "removida").
  await page.getByRole("tab", { name: /Concluídas/ }).click();
  const card = page.getByText(cliente).locator("xpath=ancestor::*[@role='button'][1]");
  await expect(card).toBeVisible();
  await expect(card.getByText("Concluida", { exact: false })).toBeVisible();
});
