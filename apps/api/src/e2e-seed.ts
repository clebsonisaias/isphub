import { UserRole } from "@isphub/shared";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./services/authService.js";
import { encrypt } from "./lib/crypto.js";

/**
 * Seed deterministico para os testes E2E (Playwright). Diferente de seed.ts
 * (que so cria o admin na primeira vez e nunca reexibe a senha), este script
 * usa upsert com credenciais FIXAS, pensadas exclusivamente para teste —
 * pode ser rodado repetidamente sem depender de estado deixado por sessoes
 * manuais anteriores.
 */

export const E2E_ADMIN_EMAIL = "e2e-admin@isphub.test";
export const E2E_ADMIN_SENHA = "e2e-senha-123";
export const E2E_GESTOR_EMAIL = "e2e-gestor@isphub.test";
export const E2E_GESTOR_SENHA = "e2e-senha-123";
export const E2E_PROVEDOR_NOME = "E2E Provider";
export const E2E_SGP_PORT = 4569;

async function main() {
  const senhaAdminHash = await hashPassword(E2E_ADMIN_SENHA);
  await prisma.usuario.upsert({
    where: { email: E2E_ADMIN_EMAIL },
    create: { nome: "E2E Admin", email: E2E_ADMIN_EMAIL, senhaHash: senhaAdminHash, role: UserRole.ADMIN },
    update: { senhaHash: senhaAdminHash, role: UserRole.ADMIN, ativo: true },
  });

  const senhaGestorHash = await hashPassword(E2E_GESTOR_SENHA);
  await prisma.usuario.upsert({
    where: { email: E2E_GESTOR_EMAIL },
    create: { nome: "E2E Gestor", email: E2E_GESTOR_EMAIL, senhaHash: senhaGestorHash, role: UserRole.GESTOR },
    update: { senhaHash: senhaGestorHash, role: UserRole.GESTOR, ativo: true },
  });

  let provedor = await prisma.provedor.findFirst({ where: { nome: E2E_PROVEDOR_NOME } });
  if (!provedor) {
    provedor = await prisma.provedor.create({ data: { nome: E2E_PROVEDOR_NOME, cor: "#38bdf8" } });
  }

  await prisma.erpConfig.upsert({
    where: { provedorId_tipo: { provedorId: provedor.id, tipo: "SGP" } },
    create: {
      provedorId: provedor.id,
      tipo: "SGP",
      url: `http://localhost:${E2E_SGP_PORT}`,
      app: "e2e",
      tokenCifrado: encrypt("e2e-token-abcdefgh"),
    },
    update: {
      url: `http://localhost:${E2E_SGP_PORT}`,
      app: "e2e",
      tokenCifrado: encrypt("e2e-token-abcdefgh"),
      ativo: true,
    },
  });

  const tipo = await prisma.tipoOs.upsert({
    where: { provedorId_sgpCodigo: { provedorId: provedor.id, sgpCodigo: "1" } },
    create: {
      provedorId: provedor.id,
      sgpCodigo: "1",
      descricao: "Sem conexao",
      visivel: true,
      slaHoras: 24,
    },
    update: { visivel: true, slaHoras: 24 },
  });

  await prisma.ordemServico.upsert({
    where: { provedorId_sgpOsId: { provedorId: provedor.id, sgpOsId: "e2e-os-1" } },
    create: {
      provedorId: provedor.id,
      sgpOsId: "e2e-os-1",
      tipoOsId: tipo.id,
      status: "aberta",
      clienteNome: "Cliente E2E",
      contratoId: "1",
      logradouro: "Rua de Teste",
      numero: "1",
      bairro: "Centro",
      cidade: "Natal",
      lat: -5.79,
      lng: -35.21,
      dataAgendamento: new Date("2026-12-31T12:00:00.000Z"),
    },
    update: {
      status: "aberta",
      clienteNome: "Cliente E2E",
    },
  });

  console.log("Seed E2E concluido:");
  console.log(`  admin:  ${E2E_ADMIN_EMAIL} / ${E2E_ADMIN_SENHA}`);
  console.log(`  gestor: ${E2E_GESTOR_EMAIL} / ${E2E_GESTOR_SENHA}`);
  console.log(`  provedor: ${E2E_PROVEDOR_NOME} (${provedor.id}), SGP mock em :${E2E_SGP_PORT}`);
}

main()
  .catch((err) => {
    console.error("Falha ao rodar o seed E2E:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
