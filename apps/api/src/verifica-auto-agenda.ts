/**
 * Verificacao do agendador automatico contra um Postgres DE VERDADE.
 *
 *   createdb isphub_auto_test
 *   DATABASE_URL=postgresql://.../isphub_auto_test npx prisma migrate deploy
 *   DATABASE_URL=... JWT_SECRET=... CRYPTO_KEY=... npm run verifica:auto-agenda -w @isphub/api
 *
 * Cobre o que o vitest puro nao cobre: a chave geral, que so a fila normal sai
 * sozinha, a idempotencia da rodada, a recusa ao aplicar por cima de visita
 * marcada, o desfazer que poupa o que o cliente confirmou e o teto por rodada.
 *
 * DESTRUTIVO: apaga agendamentos, OS, tipos e provedores. So aponte pra um banco
 * descartavel.
 */
import { ORIGEM_AUTO } from "@isphub/shared";
import { prisma } from "./lib/prisma.js";
import * as agenda from "./services/agendaService.js";
import {
  aplicarPropostas,
  desfazerLoteAuto,
  proporAgendaDoBanco,
  rodarAuto,
  saudeDoAgendador,
} from "./services/autoAgendaService.js";

let falhas = 0;
const ok = (c: boolean, m: string) => {
  if (!c) falhas++;
  console.log(`${c ? "✓" : "✗ FALHOU"} ${m}`);
};

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production" || !/test/i.test(url)) {
    console.error("verifica-auto-agenda: recusado — DATABASE_URL precisa conter 'test' e NODE_ENV nao pode ser production.");
    process.exit(1);
  }
  await prisma.agendamento.deleteMany({});
  await prisma.ordemServico.deleteMany({});
  await prisma.tipoOs.deleteMany({});
  await prisma.categoria.deleteMany({});
  await prisma.provedor.deleteMany({});

  const prov = await prisma.provedor.create({ data: { nome: "NetGo" } });
  const catReparo = await prisma.categoria.create({ data: { nome: "Reparo / Sem conexão" } });
  const catRetirada = await prisma.categoria.create({ data: { nome: "Retirada / Cancelamento", equipeExterna: true } });
  const tSem = await prisma.tipoOs.create({
    data: { provedorId: prov.id, sgpCodigo: "1", descricao: "Sem conexão", categoriaId: catReparo.id },
  });
  const tKit = await prisma.tipoOs.create({
    data: { provedorId: prov.id, sgpCodigo: "2", descricao: "REMOÇÃO DE KIT", categoriaId: catRetirada.id },
  });

  const os = (sgpOsId: string, extra: Record<string, unknown> = {}) =>
    prisma.ordemServico.create({
      data: { provedorId: prov.id, sgpOsId, status: "aberta", clienteNome: `Cliente ${sgpOsId}`, ...extra },
    });
  // 3 normais, 2 retiradas, 1 duplicada, 1 suspensa, 1 de teste.
  await os("N1", { tipoOsId: tSem.id, contratoId: "c1", pop: "Macaíba" });
  await os("N2", { tipoOsId: tSem.id, contratoId: "c2", pop: "Macaíba" });
  await os("N3", { tipoOsId: tSem.id, contratoId: "c3", pop: "SGA" });
  await os("R1", { tipoOsId: tKit.id, contratoId: "c4", pop: "Macaíba" });
  await os("R2", { tipoOsId: tKit.id, contratoId: "c5", pop: "SGA" });
  await os("DUP", { tipoOsId: tSem.id, contratoId: "c1", pop: "Macaíba" }); // mesmo contrato+tipo de N1
  await os("SUSP", { tipoOsId: tSem.id, contratoId: "c6", contratoStatus: " Suspenso" });
  await os("TESTE", { tipoOsId: tSem.id, contratoId: "c7", clienteNome: "ATENDAI TESTE APAGAR" });

  await agenda.salvarConfig({
    vagasManha: 10, vagasTarde: 10, vagasDia: null, tetoRegiao: null, antecedenciaMin: 0,
    autoAgendaAtiva: false, autoAgendaMaxRodada: 20, vagasRetiradaDia: 0, vagasUrgenciaDia: 0,
  });

  // 1) proposta: 5 propostas, duplicada e suspensa em revisao, teste ignorado
  const prop = await proporAgendaDoBanco();
  const idsProp = prop.propostas.map((p) => p.sgpOsId).sort();
  ok(JSON.stringify(idsProp) === JSON.stringify(["N1", "N2", "N3", "R1", "R2"]), `proposta tem as 5 certas: ${idsProp}`);
  const idsRev = prop.revisao.map((r) => r.sgpOsId).sort();
  ok(JSON.stringify(idsRev) === JSON.stringify(["DUP", "SUSP"]), `revisao = duplicada + suspensa: ${idsRev}`);
  ok(!prop.propostas.some((p) => p.sgpOsId === "TESTE") && !prop.revisao.some((r) => r.sgpOsId === "TESTE"), "OS de teste nao entra em lugar nenhum");

  // 2) chave desligada: a rodada nao faz nada
  const off = await rodarAuto();
  ok(!off.ativa && off.marcadas === 0 && (await prisma.agendamento.count()) === 0, "desligado: rodada nao marca nada");

  // 3) ligado: marca SO a fila normal, com origem auto
  await agenda.salvarConfig({ autoAgendaAtiva: true });
  const on = await rodarAuto();
  const marcadas = await prisma.agendamento.findMany({ select: { sgpOsId: true, origem: true, fila: true } });
  ok(on.ativa && on.marcadas === 3 && !on.erro, `ligado: marca 3 (${on.marcadas}), erro=${on.erro}`);
  ok(marcadas.every((m) => m.origem === ORIGEM_AUTO && m.fila === "normal"), "todas com origem 'auto' e fila normal");
  ok(!marcadas.some((m) => m.sgpOsId.startsWith("R")), "a retirada NAO sai sozinha");

  // 4) idempotente: nova rodada nao marca de novo
  const de_novo = await rodarAuto();
  ok(de_novo.marcadas === 0 && (await prisma.agendamento.count()) === 3, "segunda rodada nao duplica");

  // 5) lote aprovado da retirada: grava na fila retirada e conta separado
  const retir = (await proporAgendaDoBanco()).propostas.filter((p) => p.fila === "retirada");
  const ap = await aplicarPropostas(retir, "supervisor@teste");
  ok(ap.aplicadas.length === 2 && ap.recusadas.length === 0, `lote da retirada aplica 2: ${ap.aplicadas.length}/${ap.recusadas.length}`);
  const rets = await prisma.agendamento.findMany({ where: { fila: "retirada" } });
  ok(rets.length === 2 && rets.every((r) => r.marcadoPor === "supervisor@teste"), "retirada gravada com fila e quem aprovou");

  // 6) aplicar de novo por cima de visita marcada: recusa, nao sobrescreve
  const dnv = await aplicarPropostas(retir, "supervisor@teste");
  ok(dnv.aplicadas.length === 0 && dnv.recusadas.length === 2 && /marcada/i.test(dnv.recusadas[0]!.motivo), "reaplicar recusa ('ja tem visita')");

  // 7) vaga que acabou entre a proposta e a gravacao: recusa por lotacao, nao falha
  await os("L1", { tipoOsId: tSem.id, contratoId: "c8" });
  const diaCheio = (await prisma.agendamento.findFirst({ select: { dia: true, turno: true } }))!;
  const nDoDia = await prisma.agendamento.count({ where: { dia: diaCheio.dia, status: "marcado" } });
  await agenda.salvarConfig({ vagasDia: nDoDia }); // fecha esse dia exatamente no que ja esta marcado
  const rec = await aplicarPropostas(
    [{ provedorId: prov.id, sgpOsId: "L1", dia: diaCheio.dia.toISOString().slice(0, 10), turno: diaCheio.turno as "manha" | "tarde" }],
    "supervisor@teste",
  );
  ok(rec.aplicadas.length === 0 && rec.recusadas.length === 1, `vaga lotada na gravacao vira recusa: ${rec.recusadas[0]?.motivo ?? "(aplicou!)"}`);
  await agenda.salvarConfig({ vagasDia: null });

  // 8) desfazer: cancela o que e do agendador, poupa o que o cliente confirmou
  const alvo = (await prisma.agendamento.findFirst({ where: { sgpOsId: "N1" } }))!;
  await prisma.agendamento.update({ where: { id: alvo.id }, data: { confirmadoEm: new Date() } });
  const des = await desfazerLoteAuto();
  const restantes = await prisma.agendamento.findMany({ where: { status: "marcado" }, select: { sgpOsId: true } });
  ok(des.mantidasConfirmadas === 1 && des.desfeitas === 4, `desfazer: 4 desfeitas (3-1 normais + 2 retiradas = 4), 1 mantida: ${JSON.stringify(des)}`);
  ok(restantes.length === 1 && restantes[0]!.sgpOsId === "N1", "so a confirmada pelo cliente continua marcada");

  // 9) teto por rodada
  await prisma.agendamento.deleteMany({});
  await agenda.salvarConfig({ autoAgendaMaxRodada: 1 });
  const lim = await rodarAuto();
  ok(lim.marcadas === 1, `teto por rodada respeita autoAgendaMaxRodada=1: marcou ${lim.marcadas}`);

  // 10) painel de saude responde com a rodada
  const s = await saudeDoAgendador();
  ok(s.ativa && !s.rodadaAtrasada && s.ultimaRodada?.marcadas === 1, "saude: ativa, rodada recente, ultima rodada registrada");

  await prisma.$disconnect();
  if (falhas > 0) {
    console.error(`\n${falhas} verificacao(oes) falharam`);
    process.exit(1);
  }
  console.log("\ntodas as verificacoes passaram");
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
