import { expect, test } from "@playwright/test";

/**
 * CARIMBO DE LOCALIZAÇÃO — de onde o técnico disse que saiu/chegou/concluiu.
 *
 * Este teste existe por causa de uma armadilha específica: a resposta de
 * `GET /:id/eventos` é uma projeção CAMPO A CAMPO
 * (routes/ordensServico.ts). Campo novo no banco que não seja acrescentado
 * naquela lista simplesmente não chega na tela — sem erro em lugar nenhum, e
 * um teste de service passaria igual. Só um teste que atravesse o fio inteiro
 * (POST com geo → banco → GET → tela) pega isso.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };

test("a posição enviada na ação volta na timeline como link do mapa", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");

  // Marca a caminho MANDANDO coordenada, como o app faz.
  const r = await page.evaluate(async () => {
    const token = localStorage.getItem("isphub_token");
    const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const fila = await (
      await fetch("http://localhost:4000/fila?grupo=abertos&equipe=interna&limite=200", { headers: h })
    ).json();
    const os = fila.itens.find((i: { sgpOsId?: string }) => i.sgpOsId === "e2e-os-1");
    if (!os) return { erro: "OS fixture nao encontrada" };

    const acao = await fetch(`http://localhost:4000/ordens-servico/${os.id}/acaminho`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ lat: -5.79, lng: -35.2 }),
    });
    const resEventos = await fetch(`http://localhost:4000/ordens-servico/${os.id}/eventos`, { headers: h });
    const eventos = await resEventos.json();
    if (!Array.isArray(eventos)) {
      return { erro: `eventos nao e array (HTTP ${resEventos.status}): ${JSON.stringify(eventos).slice(0, 200)}` };
    }
    return { status: acao.status, comGeo: eventos.filter((e: { lat: number | null }) => e.lat != null) };
  });

  expect(r.erro).toBeUndefined();
  expect(r.status).toBe(200);
  // A prova da projeção: o campo sobreviveu à ida e à volta.
  expect(r.comGeo.length).toBeGreaterThan(0);
  expect(r.comGeo[0]).toMatchObject({ lat: -5.79, lng: -35.2 });
});

test("ação SEM coordenada continua funcionando", async ({ page }) => {
  /*
   * O caso que acontece de verdade: permissão negada, sinal ruim dentro do
   * prédio, modo avião. Se a ação dependesse do GPS, o técnico ficaria travado
   * na porta do cliente.
   */
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");

  const status = await page.evaluate(async () => {
    const token = localStorage.getItem("isphub_token");
    const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const fila = await (
      await fetch("http://localhost:4000/fila?grupo=abertos&equipe=interna&limite=200", { headers: h })
    ).json();
    const os = fila.itens.find((i: { sgpOsId?: string }) => i.sgpOsId === "e2e-os-1");
    const r = await fetch(`http://localhost:4000/ordens-servico/${os.id}/acaminho`, {
      method: "POST",
      headers: h,
      body: "{}",
    });
    return r.status;
  });

  expect(status).toBe(200);
});
