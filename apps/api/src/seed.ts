import { randomBytes } from "node:crypto";
import { UserRole } from "@isphub/shared";
import { prisma } from "./lib/prisma.js";
import { encrypt } from "./lib/crypto.js";
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

/**
 * Credencial do rastreador a partir do ambiente.
 *
 * A chave NAO pode vir cifrada no repositorio: o texto cifrado depende da
 * `CRYPTO_KEY` de cada ambiente, e commitar isso amarraria a producao a uma
 * chave que estaria no git. Entao ela chega por variavel de ambiente
 * (`PLATAFORMATK_KEY`, a mesma que o Maxxi ja usa) e e cifrada aqui, no boot,
 * com a CRYPTO_KEY do ambiente que esta subindo.
 *
 * So cria se ainda NAO houver credencial. Nunca sobrescreve o que um admin
 * configurou pela tela — a variavel e o ponto de partida, nao a autoridade.
 */
async function semearCredencialRastreador() {
  const chave = process.env.PLATAFORMATK_KEY?.trim();
  if (!chave) return;

  const existente = await prisma.rastreadorConfig.findFirst({
    where: { provedorId: null, fornecedor: "plataformatk" },
    select: { id: true },
  });
  if (existente) {
    console.log("[frota] credencial de rastreamento ja configurada. Nada a fazer.");
    return;
  }

  await prisma.rastreadorConfig.create({
    data: { provedorId: null, fornecedor: "plataformatk", chaveCifrada: encrypt(chave) },
  });
  console.log("[frota] credencial de rastreamento criada a partir de PLATAFORMATK_KEY (cifrada).");
}

main()
  .then(semearCredencialRastreador)
  .catch((err) => {
    console.error("Falha ao rodar o seed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
