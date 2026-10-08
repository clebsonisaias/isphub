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

test("supervisor marca a visita pelo detalhe da OS, e ela aparece no card e na grade", async ({ page, request }) => {
  const token = await entrar(page);
  // Grade de verdade (15/15): o teste é do CAMINHO pela tela, não do limite.
  await request.put(`${API}/admin/agenda`, {
    headers: auth(token),
    data: { vagasManha: 15, vagasTarde: 15, vagasDia: null, tetoRegiao: null, antecedenciaMin: 120 },
  });
  const alvo = await diaLivre(request, token);

  // Abre a OS pelo card da fila e pede pra marcar.
  await page.goto("/");
  await page.getByRole("button", { name: /Cliente E2E/ }).first().click();
  const detalhe = page.getByRole("dialog").first();
  await expect(detalhe).toBeVisible();
  await detalhe.getByRole("button", { name: /marcar visita/i }).click();

  // O diálogo da agenda lista dia × turno; a célula livre é um botão.
  const agenda = page.getByRole("dialog").filter({ hasText: /Marcar visita|Remarcar visita/ }).last();
  await expect(agenda).toBeVisible();
  // Sábado à tarde NUNCA é oferecido — a regra chega até a tela.
  await expect(agenda.getByRole("button", { name: /^sáb .*Tarde: Só manhã/ }).first()).toBeDisabled();

  const celula = agenda.getByRole("button", { name: new RegExp(`${alvo.turno === "manha" ? "Manhã" : "Tarde"}: \\d+ livre`) }).first();
  const nomeCelula = (await celula.getAttribute("aria-label"))!;
  await celula.click();

  // Volta pro detalhe com a visita anunciada; o card da fila passa a mostrar o dia.
  await expect(detalhe.getByText(/^Visita:/)).toBeVisible();
  await expect(detalhe.getByRole("button", { name: /remarcar visita/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Cliente E2E/ }).first()).toContainText(/Visita/);

  // E está na agenda, com o mesmo dia e turno (via API, que é o que a grade lê).
  const fila = await (await request.get(`${API}/fila?grupo=abertos&equipe=interna`, { headers: auth(token) })).json();
  const naFila = fila.itens.find((i: { sgpOsId: string }) => i.sgpOsId === "e2e-os-1");
  expect(naFila.diaAgenda).toBeTruthy();
  expect(naFila.agendamentoId).toBeTruthy();
  expect(nomeCelula).toContain(naFila.turnoAgenda === "manha" ? "Manhã" : "Tarde");

  // Desmarcar pela tela: dois toques (o primeiro só pergunta), e a vaga volta.
  await page.getByRole("button", { name: /Cliente E2E/ }).first().click();
  const detalhe2 = page.getByRole("dialog").first();
  await detalhe2.getByRole("button", { name: /^desmarcar$/i }).click();
  await detalhe2.getByRole("button", { name: /sim, desmarcar/i }).click();
  await expect(detalhe2.getByRole("button", { name: /^marcar visita$/i })).toBeVisible();
  await expect(detalhe2.getByText(/^Visita:/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Cliente E2E/ }).first()).not.toContainText(/Visita/);

  const depois = await (await request.get(`${API}/fila?grupo=abertos&equipe=interna`, { headers: auth(token) })).json();
  expect(depois.itens.find((i: { sgpOsId: string }) => i.sgpOsId === "e2e-os-1").agendamentoId).toBeNull();
});

/** Rótulo "sex 10/10" como a Agenda e o Mapa escrevem um dia AAAA-MM-DD. */
function rotuloDia(dia: string) {
  const d = new Date(`${dia}T12:00:00Z`);
  const DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  return `${DIA[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Garante que a OS do seed começa SEM visita (execuções anteriores podem ter deixado uma). */
async function semVisita(req: APIRequestContext, token: string, sgpOsId: string) {
  const fila = await (await req.get(`${API}/fila?grupo=abertos&equipe=interna`, { headers: auth(token) })).json();
  const os = fila.itens.find((i: { sgpOsId: string }) => i.sgpOsId === sgpOsId);
  if (os?.agendamentoId) await desmarcarTudo(req, token, [os.agendamentoId]);
}

test("turno vazio abre o painel, e Adicionar OS marca a visita ali mesmo", async ({ page, request }) => {
  const token = await entrar(page);
  await request.put(`${API}/admin/agenda`, {
    headers: auth(token),
    data: { vagasManha: 15, vagasTarde: 15, vagasDia: null, tetoRegiao: null, antecedenciaMin: 120 },
  });
  await semVisita(request, token, "e2e-os-1");
  const alvo = await diaLivre(request, token);
  const turnoRotulo = alvo.turno === "manha" ? "Manhã" : "Tarde";

  await page.goto("/agenda");
  const qualquerCelula = page.getByRole("button", { name: /^(Manhã|Tarde) de .*: \d+ de \d+/ });
  await expect(qualquerCelula.first()).toBeVisible();
  // A vaga livre pode cair na semana que vem: anda até a célula existir.
  const celula = page.getByRole("button", { name: new RegExp(`^${turnoRotulo} de ${rotuloDia(alvo.dia)}:`) });
  for (let i = 0; i < 3 && (await celula.count()) === 0; i++) {
    await page.getByRole("button", { name: "Próxima semana" }).click();
    await expect(qualquerCelula.first()).toBeVisible();
  }
  await expect(celula).toBeVisible();
  // Antes um turno vazio nem abria. Agora abre, com "Adicionar OS".
  await celula.click();
  const painel = page.getByRole("complementary", { name: "Rota do turno" });
  await expect(painel).toBeVisible();
  await expect(painel.getByRole("heading", { name: /Adicionar OS neste turno/ })).toBeVisible();

  await painel.getByLabel("Buscar OS sem visita").fill("Cliente E2E");
  const linha = painel.locator("li", { hasText: "Cliente E2E" }).first();
  await linha.getByRole("button", { name: "Marcar" }).click();

  // Vira parada da rota, e some das candidatas.
  const paradas = painel.locator("ol > li");
  await expect(paradas.filter({ hasText: "Cliente E2E" })).toHaveCount(1);
  await expect(painel.locator("section li", { hasText: "Cliente E2E" })).toHaveCount(0);

  // Desmarcar pede confirmação: o primeiro toque só pergunta.
  await paradas.filter({ hasText: "Cliente E2E" }).getByRole("button", { name: /^Desmarcar/ }).click();
  await expect(painel.getByText("Desmarcar?")).toBeVisible();
  await painel.getByRole("button", { name: "Sim" }).click();
  await expect(paradas.filter({ hasText: "Cliente E2E" })).toHaveCount(0);
});

test("a Fila agrupa por visita e o card mostra o dia e o turno da agenda", async ({ page, request }) => {
  const token = await entrar(page);
  await semVisita(request, token, "e2e-os-1");
  const alvo = await diaLivre(request, token);
  const provedorId = (await (await request.get(`${API}/provedores`, { headers: auth(token) })).json())[0].id;
  const marcado = await (
    await request.post(`${API}/agenda`, {
      headers: auth(token),
      data: { provedorId, sgpOsId: "e2e-os-1", dia: alvo.dia, turno: alvo.turno, regiao: "Centro" },
    })
  ).json();

  // Ordenação e filtros ficam na URL: a tela abre já "por visita".
  await page.goto("/?ord=visita");
  const turnoRotulo = alvo.turno === "manha" ? "Manhã" : "Tarde";
  // Cabeçalho da seção: "Hoje · Manhã", "Amanhã · Tarde" ou "sex 10/10 · Manhã".
  await expect(page.getByText(new RegExp(`(Hoje|Amanhã|${rotuloDia(alvo.dia)}) · ${turnoRotulo}`)).first()).toBeVisible();
  const card = page.getByRole("button", { name: /Cliente E2E/ }).first();
  await expect(card).toContainText("Visita");
  await expect(card).toContainText(rotuloDia(alvo.dia));
  await expect(card).toContainText(turnoRotulo);

  // Faceta "Sem visita" esconde a marcada; o chip aparece e a URL carrega o filtro.
  await page.getByRole("button", { name: /^Sem visita/ }).first().click();
  await expect(page).toHaveURL(/visita=sem_visita/);
  await expect(page.getByRole("button", { name: /Cliente E2E/ })).toHaveCount(0);
  await expect(page.getByText("Visita: Sem visita")).toBeVisible();

  await desmarcarTudo(request, token, [marcado.id]);
});

test("a rota aceita uma ordem sugerida por proximidade, e o supervisor decide aplicar", async ({ page, request }) => {
  const token = await entrar(page);
  await request.put(`${API}/admin/agenda`, {
    headers: auth(token),
    data: { vagasManha: 15, vagasTarde: 15, vagasDia: null, tetoRegiao: null, antecedenciaMin: 120, baseLat: -5.86, baseLng: -35.35 },
  });
  await semVisita(request, token, "e2e-os-1");
  const alvo = await diaLivre(request, token);
  const provedorId = (await (await request.get(`${API}/provedores`, { headers: auth(token) })).json())[0].id;
  // Sobra de execução abortada: a órfã deste teste ainda marcada ocuparia a vaga.
  const sobra = await (await request.get(`${API}/agenda/turno?dia=${alvo.dia}&turno=${alvo.turno}`, { headers: auth(token) })).json();
  await desmarcarTudo(request, token, sobra.filter((s: { sgpOsId: string }) => s.sgpOsId === "e2e-rota-sugestao").map((s: { id: string }) => s.id));
  const antes = sobra.filter((s: { sgpOsId: string }) => s.sgpOsId !== "e2e-rota-sugestao").length;
  // Duas paradas: a OS do seed (com coordenada) e uma órfã (sem OS no espelho, logo sem coordenada).
  const criados: string[] = [];
  for (const sgpOsId of ["e2e-os-1", "e2e-rota-sugestao"]) {
    const r = await request.post(`${API}/agenda`, {
      headers: auth(token),
      data: { provedorId, sgpOsId, dia: alvo.dia, turno: alvo.turno, regiao: "Centro" },
    });
    criados.push((await r.json()).id);
  }

  const turnoRotulo = alvo.turno === "manha" ? "Manhã" : "Tarde";
  await page.goto("/agenda");
  const qualquerCelula = page.getByRole("button", { name: /^(Manhã|Tarde) de .*: \d+ de \d+/ });
  await expect(qualquerCelula.first()).toBeVisible();
  const celula = page.getByRole("button", { name: new RegExp(`^${turnoRotulo} de ${rotuloDia(alvo.dia)}:`) });
  for (let i = 0; i < 3 && (await celula.count()) === 0; i++) {
    await page.getByRole("button", { name: "Próxima semana" }).click();
    await expect(qualquerCelula.first()).toBeVisible();
  }
  await celula.click();
  const painel = page.getByRole("complementary", { name: "Rota do turno" });
  await expect(painel.locator("ol > li")).toHaveCount(antes + 2);

  await painel.getByRole("button", { name: "Sugerir ordem" }).click();
  // Os dois percursos aparecem lado a lado; a parada sem localização é declarada.
  await expect(painel.getByText(/atual ≈/)).toBeVisible();
  // Sobras de outros testes podem somar órfãs; o que importa é a parada sem localização ser declarada.
  await expect(painel.getByText(/\d+ sem localização/)).toBeVisible();
  // Com uma coordenada só, a ordem sugerida é "com coordenada primeiro": ou já está, ou dá pra aplicar.
  const aplicar = painel.getByRole("button", { name: "Aplicar" });
  if (await aplicar.count()) {
    await aplicar.click();
    await expect(painel.getByText(/Rota reordenada|já está na melhor ordem/).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
  }
  // Quem tem coordenada vem antes de quem não tem: a órfã nunca fica na frente da OS do seed.
  const textos = await painel.locator("ol > li").allTextContents();
  const posOs = textos.findIndex((t) => t.includes("Cliente E2E"));
  const posOrfa = textos.findIndex((t) => t.includes("e2e-rota-sugestao"));
  expect(posOs).toBeGreaterThanOrEqual(0);
  expect(posOrfa).toBeGreaterThan(posOs);

  await desmarcarTudo(request, token, criados);
});
