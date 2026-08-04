import { expect, test, type Page } from "@playwright/test";

/**
 * MAPA — só o que ainda precisa de deslocamento.
 *
 * O mapa é ferramenta de rua: serve pra decidir aonde ir agora. Antes ele
 * pedia a fila inteira (encerradas junto), e como a operação fecha muito mais
 * do que tem aberto, o volume estourava o teto do servidor e disparava
 * "Mapa parcial" mesmo com poucas OS de fato em campo.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

/** Marcadores do Leaflet, separados pela FORMA do pino. */
async function marcadores(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll(".leaflet-marker-icon")];
    const formas = els.map((el) => {
      const alvo = el.querySelector("span[style]") ?? el;
      return (alvo.getAttribute("style") ?? "").includes("rotate(45deg)") ? "losango" : "circulo";
    });
    return {
      total: els.length,
      losangos: formas.filter((f) => f === "losango").length,
      circulos: formas.filter((f) => f === "circulo").length,
    };
  });
}

test("o mapa pede só as OS abertas — encerrada nao vira pino", async ({ page }) => {
  const pedidos: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/fila?")) pedidos.push(r.url());
  });

  await login(page);
  await page.goto("/mapa");
  await expect(page.getByRole("heading", { name: "Mapa" })).toBeVisible();

  const doMapa = pedidos.filter((u) => u.includes("grupo=abertos"));
  expect(doMapa.length).toBeGreaterThan(0);
  // `equipe=todas` traz as retiradas junto; sem isso elas herdavam o padrao
  // "interna" do Painel e nunca apareciam no mapa.
  expect(doMapa.some((u) => u.includes("equipe=todas"))).toBe(true);
});

test("retirada aparece com marcador diferente do servico", async ({ page }) => {
  await login(page);
  await page.goto("/mapa");
  await page.waitForSelector(".leaflet-marker-icon");

  const m = await marcadores(page);

  // O seed tem 1 retirada (e2e-os-retirada) e pelo menos 1 servico com geo.
  expect(m.losangos).toBeGreaterThan(0);
  expect(m.circulos).toBeGreaterThan(0);
});

test("dá pra ver só as retiradas", async ({ page }) => {
  await login(page);
  await page.goto("/mapa");
  await page.waitForSelector(".leaflet-marker-icon");

  await page.getByLabel("Tipo de OS no mapa").selectOption("externa");

  // `expect.poll` porque a troca dispara um refetch: medir os pinos na hora
  // leria a tela ANTES da resposta chegar.
  await expect.poll(async () => (await marcadores(page)).circulos).toBe(0);
  expect((await marcadores(page)).losangos).toBeGreaterThan(0);
});

test("dá pra ver só os serviços", async ({ page }) => {
  await login(page);
  await page.goto("/mapa");
  await page.waitForSelector(".leaflet-marker-icon");

  await page.getByLabel("Tipo de OS no mapa").selectOption("interna");

  await expect.poll(async () => (await marcadores(page)).losangos).toBe(0);
  expect((await marcadores(page)).circulos).toBeGreaterThan(0);
});

test("o recorte vai pro SERVIDOR, nao filtra pinos ja cortados no cliente", async ({ page }) => {
  /*
   * Filtrar no cliente esconderia pinos de um conjunto que o servidor pode ter
   * truncado — o mapa mostraria menos do que existe achando que mostrou tudo.
   * Pedir `equipe=externa` reduz o conjunto ANTES do teto.
   */
  const pedidos: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/fila?")) pedidos.push(r.url());
  });

  await login(page);
  await page.goto("/mapa");
  await page.waitForSelector(".leaflet-marker-icon");
  await page.getByLabel("Tipo de OS no mapa").selectOption("externa");
  await expect.poll(() => pedidos.some((u) => u.includes("equipe=externa"))).toBe(true);
});

test("a legenda so explica as formas que podem aparecer", async ({ page }) => {
  // Explicar um losango com o filtro em "Só serviços" e ruido.
  await login(page);
  await page.goto("/mapa");

  await page.getByLabel("Tipo de OS no mapa").selectOption("interna");
  await expect(page.getByText("Serviço", { exact: true })).toBeVisible();
  await expect(page.getByText("Retirada", { exact: true })).toHaveCount(0);
});

test("a legenda explica as duas formas", async ({ page }) => {
  // Marcador com significado e enigma sem legenda: quem olha ve um losango e
  // nao tem como deduzir que aquilo e retirada.
  await login(page);
  await page.goto("/mapa");

  await expect(page.getByText("Serviço", { exact: true })).toBeVisible();
  await expect(page.getByText("Retirada", { exact: true })).toBeVisible();
});

test("o contador do topo diz que sao OS ABERTAS", async ({ page }) => {
  // Sem o "aberta" explicito, o numero parece "todas as OS" e quem conhece o
  // volume da operacao acha que sumiu dado.
  await login(page);
  await page.goto("/mapa");

  await expect(page.getByText(/OS abertas? geolocalizadas?/)).toBeVisible();
});
