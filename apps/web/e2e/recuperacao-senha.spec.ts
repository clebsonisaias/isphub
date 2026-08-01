import { expect, test } from "@playwright/test";

/**
 * RECUPERACAO DE SENHA — o que da pra provar pela interface.
 *
 * O caminho feliz completo (token valido -> senha nova -> login) fica nos
 * testes de API, e nao aqui: pra exercita-lo no navegador eu precisaria expor o
 * token de recuperacao por alguma rota de teste — ou seja, criar um vazamento
 * de verdade pra facilitar um teste. O que a UI precisa garantir e o resto:
 * que ela nao denuncia quem tem conta, e que link ruim nao vira tela branca.
 */

const ADMIN = "e2e-admin@isphub.test";

test("o login oferece um caminho real pra quem esqueceu a senha", async ({ page }) => {
  await page.goto("/login");

  // Era um texto morto ("fale com o administrador") — instrucao que dependia
  // de outra pessoa estar disponivel.
  await page.getByRole("link", { name: /esqueci minha senha/i }).click();

  await expect(page).toHaveURL(/\/recuperar-senha/);
  await expect(page.getByRole("heading", { name: /recuperar acesso/i })).toBeVisible();
});

/*
 * A propriedade central: a resposta tem que ser IDENTICA pros dois casos. Se um
 * dia alguem "melhorar" a tela com um "e-mail nao encontrado", este teste cai —
 * que e exatamente o ponto. Sem ele, a tela viraria um oraculo de quem tem
 * conta pra qualquer um disposto a testar enderecos.
 */
for (const [caso, email] of [
  ["e-mail cadastrado", ADMIN],
  ["e-mail que nao existe", "ninguem-tem-esse-email@exemplo.invalid"],
] as const) {
  test(`pedir link com ${caso} mostra a mesma resposta`, async ({ page }) => {
    await page.goto("/recuperar-senha");
    await page.getByLabel("E-mail").fill(email);
    await page.getByRole("button", { name: /enviar link/i }).click();

    await expect(page.getByText(/confira sua caixa de entrada/i)).toBeVisible();
    await expect(page.getByText(/se houver uma conta/i)).toBeVisible();
    // Nada na tela pode afirmar que a conta existe (ou que nao existe).
    await expect(page.getByText(/não encontrad|nao encontrad|não existe|nao existe/i)).toHaveCount(0);
  });
}

test("link sem token explica o problema em vez de mostrar tela vazia", async ({ page }) => {
  await page.goto("/redefinir-senha");

  await expect(page.getByText(/link está incompleto/i)).toBeVisible();
  // E oferece saida — pedir outro link, nao um beco sem saida.
  await expect(page.getByRole("link", { name: /pedir novo link/i })).toBeVisible();
});

test("token invalido: a API recusa e a tela diz o que fazer", async ({ page }) => {
  await page.goto("/redefinir-senha?token=token-que-nunca-existiu");

  await page.getByLabel("Nova senha", { exact: true }).fill("senha-nova-123");
  await page.getByLabel("Repita a nova senha").fill("senha-nova-123");
  await page.getByRole("button", { name: /salvar nova senha/i }).click();

  // Sem acento de proposito: as mensagens de erro da API seguem essa convencao.
  await expect(page.getByRole("alert")).toContainText(/expirou ou ja foi usado/i);
});

test("as duas senhas precisam bater — validado antes de gastar o token", async ({ page }) => {
  // O token e de uso unico: mandar pro servidor com senhas divergentes
  // queimaria o link da pessoa por um erro de digitacao.
  await page.goto("/redefinir-senha?token=qualquer-coisa");

  await page.getByLabel("Nova senha", { exact: true }).fill("senha-nova-123");
  await page.getByLabel("Repita a nova senha").fill("senha-nova-124");
  await page.getByRole("button", { name: /salvar nova senha/i }).click();

  await expect(page.getByRole("alert")).toContainText(/não são iguais/i);
});

test("senha curta demais e barrada com a regra visivel na tela", async ({ page }) => {
  await page.goto("/redefinir-senha?token=qualquer-coisa");

  // A regra aparece como texto de apoio permanente, nao so no erro.
  await expect(page.getByText(/pelo menos 8 caracteres/i)).toBeVisible();

  await page.getByLabel("Nova senha", { exact: true }).fill("curta");
  await page.getByLabel("Repita a nova senha").fill("curta");
  await page.getByRole("button", { name: /salvar nova senha/i }).click();

  await expect(page.getByRole("alert")).toContainText(/pelo menos 8 caracteres/i);
});
