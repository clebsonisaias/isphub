import { expect, test, type Page } from "@playwright/test";

/**
 * STATUS DO CONTRATO — quem pode mudar o quê.
 *
 * Regra do dono: admin e supervisor mudam para qualquer status, a qualquer
 * hora; técnico só de **Inativo → Ativo**, ao pé da letra.
 *
 * O caso que separa uma implementação certa de uma plausível é o técnico em
 * contrato SUSPENSO ou CANCELADO: os dois "parecem inativo" para quem lê rápido,
 * e nos dois o técnico tem de ser barrado. Um casamento de texto por substring
 * (`"inativo".includes("ativo")`) inverteria justamente esses.
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };
const GESTOR = { email: "e2e-gestor@isphub.test", senha: "e2e-senha-123" };
const TECNICO = { email: "e2e-tecnico@isphub.test", senha: "e2e-senha-123" };

async function login(page: Page, quem: { email: string; senha: string }) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(quem.email);
  await page.getByLabel("Senha", { exact: true }).fill(quem.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

/** Abre o detalhe da OS cujo cliente tem este nome. */
async function abrirOs(page: Page, cliente: string) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(cliente) }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("admin e supervisor", () => {
  for (const [rotulo, quem] of [
    ["admin", ADMIN],
    ["supervisor (gestor)", GESTOR],
  ] as const) {
    test(`${rotulo} escolhe qualquer status`, async ({ page }) => {
      await login(page, quem);
      await abrirOs(page, "Cliente Contrato Inativo");

      const seletor = page.getByLabel("Novo status do contrato");
      await expect(seletor).toBeVisible();

      // Todos menos o atual (Inativo) — 6 opções + o placeholder.
      const opcoes = await seletor.locator("option").allTextContents();
      expect(opcoes).toContain("Ativo");
      expect(opcoes).toContain("Cancelado");
      expect(opcoes).toContain("Suspenso");
      // O status ATUAL não é oferecido: "mudar" para onde já se está não é mudança.
      expect(opcoes).not.toContain("Inativo");
    });
  }

  test("admin muda de verdade, e a mudança atravessa até o SGP", async ({ page }) => {
    /*
     * Opera na OS "Mutavel", que existe só para ser mudada e que nenhum outro
     * spec lê. Mudar uma OS compartilhada faz o vizinho falhar conforme a ORDEM
     * de execução — o pior tipo de teste quebrado, porque passa sozinho.
     */
    await login(page, ADMIN);
    await abrirOs(page, "Cliente Contrato Mutavel");

    await page.getByLabel("Novo status do contrato").selectOption({ label: "Suspenso" });
    await page.getByRole("button", { name: "Aplicar" }).click();

    // Suspender tira o cliente do ar — o aviso é obrigatório antes de confirmar.
    await expect(page.getByText("Isso tira o cliente do ar imediatamente.")).toBeVisible();
    await page.getByRole("button", { name: "Confirmar" }).click();

    await expect(page.getByText(/Contrato agora está Suspenso/)).toBeVisible();
  });
});

test.describe("técnico", () => {
  test("reativa contrato INATIVO — e é um botão, não um seletor", async ({ page }) => {
    // Uma opção só não merece dropdown: quem está na porta do cliente escolhe
    // entre "a única coisa possível" e nada.
    await login(page, TECNICO);
    await abrirOs(page, "Cliente Contrato Inativo");

    await expect(page.getByRole("button", { name: "Reativar contrato" })).toBeVisible();
    await expect(page.getByLabel("Novo status do contrato")).toHaveCount(0);
  });

  test("NÃO mexe em contrato ativo", async ({ page }) => {
    await login(page, TECNICO);
    await abrirOs(page, "Cliente E2E");

    await expect(page.getByRole("button", { name: "Reativar contrato" })).toHaveCount(0);
    await expect(page.getByLabel("Novo status do contrato")).toHaveCount(0);
  });

  test("a API recusa com 403, mesmo sem passar pela tela", async ({ page }) => {
    /*
     * A guarda de verdade é do servidor. A tela esconder o controle é
     * conveniência — quem chamar a rota direto tem de bater no mesmo muro.
     * 403 (e não 400): o pedido está bem formado, o papel é que não alcança.
     */
    await login(page, TECNICO);
    const r = await page.evaluate(async () => {
      const token = localStorage.getItem("isphub_token");
      const fila = await (
        await fetch("http://localhost:4000/fila?grupo=abertos&equipe=todas&limite=200", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json();
      /*
       * A OS que o técnico DE FATO enxerga (é dele) e onde ele TEM uma ação
       * possível — pedindo justamente a que não tem. É o caso mais afiado:
       * não é "não vejo essa OS", é "vejo, posso uma coisa, e essa não é".
       */
      const alvo = fila.itens.find((i: { clienteNome?: string }) =>
        i.clienteNome?.includes("Contrato Inativo"),
      );
      if (!alvo) return { status: 0, motivo: "OS de contrato inativo nao encontrada" };
      const res = await fetch(`http://localhost:4000/ordens-servico/${alvo.id}/contrato-status`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        // 3 = Cancelado. O técnico só faz Inativo -> Ativo.
        body: JSON.stringify({ status: 3 }),
      });
      return { status: res.status, corpo: await res.json().catch(() => null) };
    });

    expect(r.status).toBe(403);
    expect(r.corpo?.error).toMatch(/reativa contrato inativo/i);
  });
});

test.describe("trilha", () => {
  test("a mudança aparece no histórico da OS com quem fez", async ({ page }) => {
    /*
     * A implementação de referência (Maxxi) registra em comentário um incidente
     * causado por "mudanças via URA sem rastro". A trilha nasceu junto com a
     * funcionalidade justamente por isso.
     */
    await login(page, ADMIN);
    await abrirOs(page, "Cliente Contrato Mutavel");

    await page.getByLabel("Novo status do contrato").selectOption({ label: "Novo" });
    await page.getByRole("button", { name: "Aplicar" }).click();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/Contrato agora está Novo/)).toBeVisible();

    await page.getByRole("tab", { name: /hist[óo]rico/i }).click();
    // `.first()`: o banco de teste e persistente, entao cada rodada soma mais
    // um evento igual. A afirmacao aqui e "a mudanca ficou registrada",
    // nao "existe exatamente uma".
    await expect(page.getByText(/Contrato 6:.*→ Novo/).first()).toBeVisible();
    await expect(page.getByText("E2E Admin").first()).toBeVisible();
  });
});
