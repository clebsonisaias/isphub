import { randomBytes } from "node:crypto";
import { UserRole } from "@isphub/shared";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./services/authService.js";

/**
 * Seed minimo: garante que exista um usuario admin para o primeiro acesso.
 * Se ja existir, nao faz nada (idempotente). A senha e gerada aleatoriamente
 * e impressa uma unica vez — nunca fica hardcoded no repositorio.
 */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@isphub.com.br";

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    console.log(`Usuario admin ja existe (${email}). Nada a fazer.`);
    return;
  }

  const senha = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
  const senhaHash = await hashPassword(senha);

  await prisma.usuario.create({
    data: {
      nome: "Administrador ISPhub",
      email,
      senhaHash,
      role: UserRole.ADMIN,
    },
  });

  console.log("Usuario admin criado com sucesso:");
  console.log(`  email: ${email}`);
  console.log(`  senha: ${senha}`);
  console.log("Guarde esta senha agora — ela nao sera exibida novamente.");
}

main()
  .catch((err) => {
    console.error("Falha ao rodar o seed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
