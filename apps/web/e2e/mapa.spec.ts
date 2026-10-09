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

/** Marcadores do Leaflet, separados pela FORMA e pela presença do halo. */
async function marcadores(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll(".leaflet-marker-icon")];
    const estilos = els.map((el) => {
      const alvo = el.querySelector("span[style]") ?? el;
      return alvo.getAttribute("style") ?? "";
    });
    return {
      total: els.length,
      losangos: estilos.filter((s) => s.includes("rotate(45deg)")).length,
      circulos: estilos.filter((s) => !s.includes("rotate(45deg)")).length,
      // O halo é o anel `0 0 0 3px` empilhado ANTES da sombra de profundidade.
      comHalo: estilos.filter((s) => s.includes("0px 0px 0px 3px")).length,
      // O preenchimento tem que continuar sendo a cor do provedor.
      comPreenchimento: estilos.filter((s) => s.includes("background-color")).length,
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

  /*
   * Espera o estado ASSENTADO, nao so "zero circulos": durante o refetch o
   * mapa troca por esqueleto e fica com ZERO marcadores — o que satisfaria uma
   * espera ingenua por "circulos === 0" e mediria a tela vazia.
   */
  await expect.poll(async () => {
    const m = await marcadores(page);
    return m.total > 0 && m.circulos === 0;
  }).toBe(true);
  expect((await marcadores(page)).losangos).toBeGreaterThan(0);
});

test("dá pra ver só os serviços", async ({ page }) => {
  await login(page);
  await page.goto("/mapa");
  await page.waitForSelector(".leaflet-marker-icon");

  await page.getByLabel("Tipo de OS no mapa").selectOption("interna");

  await expect.poll(async () => {
    const m = await marcadores(page);
    return m.total > 0 && m.losangos === 0;
  }).toBe(true);
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

/*
 * HALO = contrato irregular. É o sinal que evita o erro mais caro da operação:
 * mandar técnico à casa de um contrato cancelado. O seed tem exatamente uma OS
 * assim (e2e-os-cancelada).
 */
test("contrato irregular ganha halo; contrato ativo nao", async ({ page }) => {
  await login(page);
  await page.goto("/mapa");
  await page.waitForSelector(".leaflet-marker-icon");

  const m = await marcadores(page);

  expect(m.comHalo).toBe(1);
  // Se TODO pino tivesse halo, o sinal nao sinalizaria nada.
  expect(m.comHalo).toBeLessThan(m.total);
});

test("o halo NAO substitui a cor do provedor", async ({ page }) => {
  /*
   * A cor do preenchimento e o unico canal panoramico de identidade do
   * provedor (o nome so aparece dentro do popup). Se alguem "simplificar" o
   * halo pra pintar o preenchimento, todo pino normal fica cinza e esse teste
   * cai.
   */
  await login(page);
  await page.goto("/mapa");
  await page.waitForSelector(".leaflet-marker-icon");

  const m = await marcadores(page);

  expect(m.comPreenchimento).toBe(m.total);
});

test("a legenda do halo so aparece quando ha contrato irregular", async ({ page }) => {
  await login(page);
  await page.goto("/mapa");
  await page.waitForSelector(".leaflet-marker-icon");

  await expect(page.getByText(/Contrato irregular \(1\)/)).toBeVisible();

  // Só retiradas: a única OS de contrato cancelado é de serviço, então o
  // recorte fica sem irregular nenhum e a legenda tem que sumir.
  await page.getByLabel("Tipo de OS no mapa").selectOption("externa");
  await expect.poll(async () => {
    const m = await marcadores(page);
    return m.total > 0 && m.comHalo === 0;
  }).toBe(true);
  await expect(page.getByText(/Contrato irregular/)).toHaveCount(0);
});

test("o contador do topo diz que sao OS ABERTAS", async ({ page }) => {
  // Sem o "aberta" explicito, o numero parece "todas as OS" e quem conhece o
  // volume da operacao acha que sumiu dado.
  await login(page);
  await page.goto("/mapa");

  await expect(page.getByText(/OS abertas? geolocalizadas?/)).toBeVisible();
});

test("rota de um turno: pinos numerados pela ordem da rota, e só as visitas daquela janela", async ({ page, request }) => {
  await login(page);
  const token = (await page.evaluate(() => localStorage.getItem("isphub_token"))) as string;
  const auth = { Authorization: `Bearer ${token}` };
  const API = "http://localhost:4000";

  const fila = await (await request.get(`${API}/fila?grupo=abertos&equipe=interna`, { headers: auth })).json();
  // Qualquer OS aberta com coordenada (o pino precisa de lat/lng). Nao fixa
  // e2e-os-1: o isphub.spec a conclui antes na mesma execucao, e ai ela some
  // da fila de abertas.
  type Item = { sgpOsId: string; provedorId: string; agendamentoId?: string | null; endereco: { lat: number | null } };
  const os = (fila.itens as Item[]).find((i) => i.endereco.lat != null);
  if (!os) throw new Error("seed sem OS aberta geolocalizada");
  if (os.agendamentoId) await request.delete(`${API}/agenda/${os.agendamentoId}`, { headers: auth });
  const [vaga] = await (await request.get(`${API}/agenda/proximas?quantas=1`, { headers: auth })).json();
  const marcado = await (
    await request.post(`${API}/agenda`, {
      headers: auth,
      data: { provedorId: os.provedorId, sgpOsId: os.sgpOsId, dia: vaga.dia, turno: vaga.turno, regiao: "Centro" },
    })
  ).json();

  await page.goto("/mapa");
  const seletor = page.getByLabel("Rota de um turno");
  await seletor.selectOption(`${vaga.dia}|${vaga.turno}`);
  // O título passa a contar paradas, e o pino traz o número da parada.
  await expect(page.getByText(/1 parada na rota/)).toBeVisible();
  await expect(page.locator(".leaflet-marker-icon", { hasText: "1" })).toHaveCount(1);
  // Filtros de equipe/provedor não valem no modo rota.
  await expect(page.getByLabel("Tipo de OS no mapa")).toHaveCount(0);

  await seletor.selectOption("");
  await expect(page.getByLabel("Tipo de OS no mapa")).toBeVisible();

  await request.delete(`${API}/agenda/${marcado.id}`, { headers: auth });
});
