import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * AGENDA — a planilha de agendamento de OS, com o limite ANTES da promessa.
 *
 * O que a planilha do Drive não fazia e é o que estes testes protegem: ela
 * avisava ("Verificar concentração") depois que a atendente já tinha combinado
 * o horário com o cliente. Aqui o turno cheio simplesmente não é ofertado.
 *
 * As marcações entram pela API (com o token da própria sessão) e não pela tela:
 * na Fase 1 quem marca é o atendimento, e é assim que a marcação chega — o que
 * a TELA precisa provar é a leitura da grade e a roteirização.
 */

const API = "http://localhost:4000";
const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };

/**
 * A suíte roda contra um banco COMPARTILHADO e reaproveita o servidor, então
 * marcação que sobra vira vaga ocupada na execução seguinte — e o teste que
 * lota um turno de 2 passa a começar já lotado. Cada teste desfaz o que marcou.
 */
async function desmarcarTudo(req: APIRequestContext, token: string, ids: string[]) {
  for (const id of ids) await req.delete(`${API}/agenda/${id}`, { headers: auth(token) });
}

async function entrar(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
  return (await page.evaluate(() => localStorage.getItem("isphub_token"))) as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Um dia útil longe da antecedência mínima — e determinístico entre execuções. */
async function diaLivre(req: APIRequestContext, token: string) {
  const r = await req.get(`${API}/agenda/proximas?quantas=1`, { headers: auth(token) });
  const [vaga] = await r.json();
  return vaga as { dia: string; turno: "manha" | "tarde" };
}

test("turno lotado some da oferta em vez de virar aviso", async ({ page, request }) => {
  const token = await entrar(page);

  // Grade minúscula pra lotar em duas marcações — o teste é da REGRA, não do 20.
  await request.put(`${API}/admin/agenda`, {
    headers: auth(token),
    data: { vagasManha: 2, vagasTarde: 2, tetoRegiao: null, antecedenciaMin: 120 },
  });

  const alvo = await diaLivre(request, token);
  const provedorId = (await (await request.get(`${API}/provedores`, { headers: auth(token) })).json())[0].id;

  const marcar = (sgpOsId: string) =>
    request.post(`${API}/agenda`, {
      headers: auth(token),
      data: { provedorId, sgpOsId, dia: alvo.dia, turno: alvo.turno, regiao: "Centro" },
    });

  const uma = await marcar("e2e-ag-1");
  const duas = await marcar("e2e-ag-2");
  expect(uma.status()).toBe(201);
  expect(duas.status()).toBe(201);
  const criados = [(await uma.json()).id, (await duas.json()).id];

  // A terceira é RECUSADA — e é aqui que a planilha só teria avisado.
  const terceira = await marcar("e2e-ag-3");
  expect(terceira.status()).toBe(409);
  expect((await terceira.json()).error).toMatch(/lotado/i);

  // E some da oferta: quem for oferecer ao cliente não enxerga mais esta janela.
  const proximas = await (await request.get(`${API}/agenda/proximas?quantas=20`, { headers: auth(token) })).json();
  expect(proximas.some((v: typeof alvo) => v.dia === alvo.dia && v.turno === alvo.turno)).toBe(false);

  // Na tela o turno aparece cheio, com o motivo escrito.
  await page.goto("/agenda");
  const turno = page.getByRole("button", { name: new RegExp(`${alvo.turno === "manha" ? "Manhã" : "Tarde"}.*2 de 2`, "i") });
  await expect(turno.first()).toContainText("Lotado");

  // Devolve a grade real e a vaga, pra não contaminar outras execuções.
  await request.put(`${API}/admin/agenda`, {
    headers: auth(token),
    data: { vagasManha: 20, vagasTarde: 20 },
  });
  await desmarcarTudo(request, token, criados);
});

test("domingo não é ofertado nem com a agenda vazia", async ({ page, request }) => {
  const token = await entrar(page);
  const proximas = await (await request.get(`${API}/agenda/proximas?quantas=30`, { headers: auth(token) })).json();
  // A planilha mostrava domingo com a capacidade cheia, como qualquer outro dia.
  const domingos = proximas.filter((v: { dia: string }) => new Date(`${v.dia}T12:00:00Z`).getUTCDay() === 0);
  expect(domingos).toHaveLength(0);

  await page.goto("/agenda");
  await expect(page.getByText("Sem atendimento").first()).toBeVisible();
});

test("a rota do supervisor persiste e chega na fila que o app do técnico lê", async ({ page, request }) => {
  const token = await entrar(page);
  const alvo = await diaLivre(request, token);
  const provedorId = (await (await request.get(`${API}/provedores`, { headers: auth(token) })).json())[0].id;

  /*
   * `e2e-os-1` é a OS do seed, e é ESPELHADA — só ela pode provar a última
   * asserção. A agenda aceita marcar uma OS que ainda não chegou ao espelho
   * (é a corrida do atendimento), mas `/fila` só devolve o que já chegou:
   * marcar duas órfãs deixaria a fila vazia e o teste mediria o nada.
   */
  const criados: string[] = [];
  for (const id of ["e2e-os-1", "e2e-rota-b"]) {
    const r = await request.post(`${API}/agenda`, {
      headers: auth(token),
      data: { provedorId, sgpOsId: id, dia: alvo.dia, turno: alvo.turno },
    });
    criados.push((await r.json()).id);
  }

  await page.goto("/agenda");
  const rotulo = alvo.turno === "manha" ? "Manhã" : "Tarde";
  await page.getByRole("button", { name: new RegExp(`^${rotulo} de .*: [1-9]`, "i") }).first().click();

  /*
   * Ancorado nas DUAS paradas que este teste criou, e não na contagem da lista:
   * o banco é compartilhado e o turno pode ter vindo com marcações de outra
   * execução — contar seria testar a limpeza alheia, não a roteirização.
   */
  const paradas = page.locator("ol > li");
  const posicaoDe = async (sgpOsId: string) => {
    const textos = await paradas.allInnerTexts();
    return textos.findIndex((t) => t.includes(sgpOsId));
  };
  // A OS espelhada aparece pelo NOME do cliente; a órfã, pelo id do SGP.
  await expect(paradas.filter({ hasText: "Cliente E2E" })).toHaveCount(1);
  const antesA = await posicaoDe("Cliente E2E");
  const antesB = await posicaoDe("e2e-rota-b");
  const primeira = antesA < antesB ? "Cliente E2E" : "e2e-rota-b";
  const segunda = antesA < antesB ? "e2e-rota-b" : "Cliente E2E";

  // Setas e não arrastar: o supervisor reordena no celular, na rua.
  await paradas.filter({ hasText: primeira }).getByRole("button", { name: /descer/i }).click();
  await expect
    .poll(async () => (await posicaoDe(primeira)) > (await posicaoDe(segunda)))
    .toBe(true);

  // A ordem tem que SOBREVIVER ao reload — se ficasse só no estado do React, a
  // rota some no primeiro F5 e ninguém descobre até o técnico sair errado.
  await page.reload();
  await page.getByRole("button", { name: new RegExp(`^${rotulo} de .*: [1-9]`, "i") }).first().click();
  await expect(paradas.filter({ hasText: primeira })).toHaveCount(1);
  expect(await posicaoDe(primeira)).toBeGreaterThan(await posicaoDe(segunda));

  // E chega em `/fila`, que é de onde o app do técnico monta o dia.
  const fila = await (await request.get(`${API}/fila?grupo=abertos&equipe=interna`, { headers: auth(token) })).json();
  const naFila = fila.itens.find((i: { sgpOsId: string }) => i.sgpOsId === "e2e-os-1");
  expect(naFila.ordemRota).not.toBeNull();
  expect(naFila.turnoAgenda).toBe(alvo.turno);

  await desmarcarTudo(request, token, criados);
});
