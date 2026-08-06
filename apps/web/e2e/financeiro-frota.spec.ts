import { expect, test, type Page } from "@playwright/test";

/**
 * FROTA — abastecimento vira despesa, e o consumo só é medido quando dá.
 *
 * Duas coisas que o ERP de origem guarda e aqui são calculadas: o vínculo com o
 * financeiro (lá é um booleano `synced_to_finance` ao lado da FK, dois fatos
 * sobre a mesma coisa) e o saldo do cartão (lá é `current_balance` no cartão E
 * `new_balance` em cada movimento — três versões do mesmo número).
 */

const ADMIN = { email: "e2e-admin@isphub.test", senha: "e2e-senha-123" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@provedor.com.br").fill(ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/");
}

const unico = () => `${Date.now()}`.slice(-6);
const linhaDe = (page: Page, t: string) => page.getByRole("listitem").filter({ hasText: t });

async function criarVeiculo(page: Page, placa: string) {
  await page.getByRole("button", { name: "Veículo" }).click();
  await page.getByLabel("Placa").fill(placa);
  await page.getByLabel("Modelo").fill("Saveiro");
  await page.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function abastecer(
  page: Page,
  opts: { placa: string; km: string; litros: string; valor: string; cheio?: boolean },
) {
  await page.getByRole("button", { name: "Abastecimento" }).click();
  // Escolha EXPLICITA: a base de teste acumula veiculos entre execucoes, e o
  // diálogo so pre-seleciona quando ha exatamente um.
  await page.getByLabel("Veículo").selectOption({ label: `${opts.placa} — Saveiro` });
  await page.getByLabel("Odômetro").fill(opts.km);
  await page.getByLabel("Litros").fill(opts.litros);
  await page.getByLabel("Valor").fill(opts.valor);
  if (opts.cheio === false) await page.getByLabel("Encheu o tanque").uncheck();
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("a aba existe e abre", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro");
  await page.getByRole("link", { name: "Frota" }).click();
  await expect(page).toHaveURL(/\/financeiro\/frota$/);
});

test("o abastecimento gera a despesa no financeiro", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/frota");

  const placa = `TST${unico().slice(-4)}`;
  await criarVeiculo(page, placa);
  await abastecer(page, { placa, km: "10000", litros: "40", valor: "300,00" });
  await expect(linhaDe(page, placa)).toBeVisible();

  // A despesa existe do outro lado — o vínculo é a FK, não um "já sincronizou".
  await page.goto("/financeiro");
  await page.getByRole("tab", { name: "A pagar" }).click();
  await page.getByLabel("Buscar lançamento").fill(`Combustivel ${placa}`);
  await expect(linhaDe(page, `Combustivel ${placa}`)).toBeVisible();
  await expect(linhaDe(page, `Combustivel ${placa}`).getByText("R$ 300,00")).toBeVisible();
});

test("o consumo só aparece a partir do SEGUNDO tanque cheio", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/frota");

  const placa = `CON${unico().slice(-4)}`;
  await criarVeiculo(page, placa);

  // Primeiro cheio: sem km anterior, não há o que dividir.
  await abastecer(page, { placa, km: "1000", litros: "50", valor: "250,00" });
  await expect(linhaDe(page, placa).filter({ hasText: "1.000 km" })).toContainText("—");

  // Segundo cheio: 1400-1000 = 400 km com 40 L = 10,0 km/l.
  await abastecer(page, { placa, km: "1400", litros: "40", valor: "200,00" });
  // Ancorado na PLACA: a base de teste persiste, e outras execuções deixaram
  // veículos com o mesmo odômetro.
  await expect(linhaDe(page, placa).filter({ hasText: "1.400 km" })).toContainText("10,0 km/l");
});

test("abastecimento parcial não inventa consumo", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/frota");

  const placa = `PAR${unico().slice(-4)}`;
  await criarVeiculo(page, placa);
  await abastecer(page, { placa, km: "500", litros: "40", valor: "200,00" });
  await abastecer(page, { placa, km: "800", litros: "20", valor: "100,00", cheio: false });

  const parcial = linhaDe(page, placa).filter({ hasText: "800 km" });
  await expect(parcial).toContainText("parcial");
  await expect(parcial).toContainText("—");
});

test("odômetro que anda para trás é recusado antes de enviar", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/frota");

  const placa = `RET${unico().slice(-4)}`;
  await criarVeiculo(page, placa);
  await abastecer(page, { placa, km: "9000", litros: "30", valor: "150,00" });

  await page.getByRole("button", { name: "Abastecimento" }).click();
  await page.getByLabel("Veículo").selectOption({ label: `${placa} — Saveiro` });
  await page.getByLabel("Odômetro").fill("8000");
  await page.getByLabel("Litros").fill("30");
  await page.getByLabel("Valor").fill("150,00");

  await expect(page.getByText("Menor que o último.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar" })).toBeDisabled();
});

test("o saldo do cartão é a soma dos movimentos", async ({ page }) => {
  await login(page);
  await page.goto("/financeiro/frota");
  await page.getByRole("tab", { name: "Cartões" }).click();

  const numero = `CARD-${unico()}`;
  await page.getByRole("button", { name: "Cartão" }).click();
  await page.getByLabel("Número").fill(numero);
  await page.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linhaDe(page, numero)).toContainText("R$ 0,00");

  // Depósito soma…
  await linhaDe(page, numero).getByRole("button", { name: "Movimentar" }).click();
  await page.getByLabel("Valor").fill("500,00");
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linhaDe(page, numero)).toContainText("R$ 500,00");

  // …e consumo subtrai, sem valor negativo gravado.
  await linhaDe(page, numero).getByRole("button", { name: "Movimentar" }).click();
  await page.getByLabel("Tipo").selectOption("consumo");
  await page.getByLabel("Valor").fill("120,00");
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linhaDe(page, numero)).toContainText("R$ 380,00");
});
