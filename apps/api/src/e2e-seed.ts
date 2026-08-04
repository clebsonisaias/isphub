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
export const E2E_TECNICO_EMAIL = "e2e-tecnico@isphub.test";
/** Nome exibido na secao "Despacho" da fila — usado pelo spec do filtro. */
export const E2E_TECNICO_NOME = "E2E Tecnico";
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

  // Tecnico com UMA OS despachada: e o que permite o spec do filtro de
  // despacho exercitar os dois lados (o que falta despachar e o que ja tem
  // dono). Sem ele, todas as OS ficariam em "A despachar" e metade da
  // funcionalidade nao teria como ser testada.
  const senhaTecnicoHash = await hashPassword(E2E_ADMIN_SENHA);
  const tecnico = await prisma.usuario.upsert({
    where: { email: E2E_TECNICO_EMAIL },
    create: { nome: E2E_TECNICO_NOME, email: E2E_TECNICO_EMAIL, senhaHash: senhaTecnicoHash, role: UserRole.TECNICO },
    update: { nome: E2E_TECNICO_NOME, senhaHash: senhaTecnicoHash, role: UserRole.TECNICO, ativo: true },
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

  // Despacha a e2e-os-1 pro tecnico (fora do upsert acima pra nao depender de
  // ela ter sido criada agora ou ja existir de uma execucao anterior).
  await prisma.ordemServico.update({
    where: { provedorId_sgpOsId: { provedorId: provedor.id, sgpOsId: "e2e-os-1" } },
    data: { tecnicoId: tecnico.id },
  });

  /*
   * OS de EQUIPE EXTERNA (retirada), com coordenada: e o unico caso que
   * exercita o marcador em losango do mapa. Sem ela o mapa so teria circulos e
   * a distincao passaria despercebida ate alguem reclamar em producao.
   */
  const categoriaRetirada = await prisma.categoria.upsert({
    where: { nome: "E2E Retirada" },
    create: { nome: "E2E Retirada", cor: "#f59e0b", equipeExterna: true },
    update: { equipeExterna: true },
  });
  const tipoRetirada = await prisma.tipoOs.upsert({
    where: { provedorId_sgpCodigo: { provedorId: provedor.id, sgpCodigo: "99" } },
    create: {
      provedorId: provedor.id,
      sgpCodigo: "99",
      descricao: "Retirada de equipamento",
      categoriaId: categoriaRetirada.id,
      visivel: true,
    },
    update: { categoriaId: categoriaRetirada.id, visivel: true },
  });
  await prisma.ordemServico.upsert({
    where: { provedorId_sgpOsId: { provedorId: provedor.id, sgpOsId: "e2e-os-retirada" } },
    create: {
      provedorId: provedor.id,
      sgpOsId: "e2e-os-retirada",
      tipoOsId: tipoRetirada.id,
      status: "aberta",
      clienteNome: "Cliente Retirada",
      contratoId: "3",
      logradouro: "Rua da Retirada",
      numero: "9",
      cidade: "Natal",
      lat: -5.8,
      lng: -35.22,
      dataAgendamento: new Date("2026-12-31T12:00:00.000Z"),
    },
    update: { status: "aberta", tipoOsId: tipoRetirada.id, clienteNome: "Cliente Retirada", tecnicoId: null },
  });

  // Sem tipoOsId (regressao do recorte interna/externa): uma OS sem tipo
  // mapeado nao tem como saber se e de equipe externa, entao deve SEMPRE
  // ficar na fila interna (Painel) — nunca sumir por causa da nova clausula
  // equipe (ver equipeService.ts, whereEquipeOs).
  await prisma.ordemServico.upsert({
    where: { provedorId_sgpOsId: { provedorId: provedor.id, sgpOsId: "e2e-os-sem-tipo" } },
    create: {
      provedorId: provedor.id,
      sgpOsId: "e2e-os-sem-tipo",
      tipoOsId: null,
      status: "aberta",
      clienteNome: "Cliente Sem Tipo",
      contratoId: "2",
      dataAgendamento: new Date("2026-12-31T12:00:00.000Z"),
    },
    update: {
      status: "aberta",
      clienteNome: "Cliente Sem Tipo",
      tipoOsId: null,
      /*
       * `tecnicoId: null` EXPLICITO. Sem isto o seed nao entrega o estado que
       * promete: esta OS herdava o tecnico deixado por um teste anterior (o
       * fluxo de despacho pega um card da lista), e o spec do filtro de
       * despacho via "A despachar 0" numa rodada e 1 na seguinte, conforme a
       * ordem em que a suite tivesse rodado antes.
       */
      tecnicoId: null,
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
