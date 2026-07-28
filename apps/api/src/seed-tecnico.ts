import { UserRole } from "@isphub/shared";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./services/authService.js";

/**
 * Seed de DEV: cria um tecnico com senha conhecida e atribui algumas OS abertas
 * a ele, pra testar o app do tecnico (a fila dele so mostra OS atribuidas).
 * Idempotente. NAO usar em producao.
 */
const EMAIL = "tecnico@isphub.test";
const SENHA = "tecnico123";

const senhaHash = await hashPassword(SENHA);
const tecnico = await prisma.usuario.upsert({
  where: { email: EMAIL },
  update: { ativo: true, role: UserRole.TECNICO },
  create: { nome: "Técnico Teste", email: EMAIL, senhaHash, role: UserRole.TECNICO, ativo: true },
});

// Atribui ate 5 OS abertas (sem tecnico) a ele, pra a fila nao vir vazia.
const abertas = await prisma.ordemServico.findMany({
  where: { status: { in: ["aberta", "em_deslocamento", "em_execucao", "pendente"] }, tecnicoId: null },
  take: 5,
  orderBy: { criadoEm: "desc" },
  select: { id: true },
});
if (abertas.length > 0) {
  await prisma.ordemServico.updateMany({
    where: { id: { in: abertas.map((o) => o.id) } },
    data: { tecnicoId: tecnico.id },
  });
}

console.log(`Tecnico de teste pronto: ${EMAIL} / ${SENHA} — ${abertas.length} OS atribuidas`);
await prisma.$disconnect();
