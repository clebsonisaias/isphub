/**
 * Verificacao da agenda contra um Postgres DE VERDADE.
 *
 *   createdb isphub_agenda_test
 *   DATABASE_URL=postgresql://.../isphub_agenda_test npx prisma migrate deploy
 *   DATABASE_URL=... JWT_SECRET=... CRYPTO_KEY=... npm run verifica:agenda -w @isphub/api
 *
 * Existe separado da suite de vitest porque os 861 testes do repo sao PUROS, e
 * o que este script cobre nao e: o advisory lock que serializa a marcacao, a
 * reconciliacao do que foi agendado direto no SGP, e a marcacao aceita antes de
 * a OS existir no espelho. Sao exatamente as tres coisas que so quebram com
 * banco e concorrencia reais — e que um mock diria estar funcionando.
 *
 * DESTRUTIVO: apaga agendamentos, OS e provedores. So aponte pra um banco
 * descartavel.
 */
import { prisma } from "./lib/prisma.js";
import * as agenda from "./services/agendaService.js";

const ok = (c: boolean, m: string) => console.log(`${c ? "✓" : "✗ FALHOU"} ${m}`);

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production" || !/test/i.test(url)) {
    console.error("verifica-agenda: recusado — DATABASE_URL precisa conter 'test' e NODE_ENV nao pode ser production.");
    process.exit(1);
  }
  await prisma.agendamento.deleteMany({});
  await prisma.ordemServico.deleteMany({});
  await prisma.provedor.deleteMany({});
  const prov = await prisma.provedor.create({ data: { nome: "NetGo" } });
  await agenda.salvarConfig({ vagasManha: 3, vagasTarde: 3, vagasDia: null, tetoRegiao: 2, antecedenciaMin: 0 });

  const hoje = agenda.diaBrDe(new Date());
  const dia = agenda.somarDias(hoje, 3); // longe da antecedencia
  const diaUtil = agenda.diaDaSemana(dia) === 0 ? agenda.somarDias(dia, 1) : dia;

  // 1) marca ate lotar
  for (let i = 1; i <= 3; i++) {
    await agenda.marcar({ provedorId: prov.id, sgpOsId: `OS-${i}`, dia: diaUtil, turno: "manha", origem: "isphub" });
  }
  let g = await agenda.grade({ de: diaUtil, ate: diaUtil });
  const manha = g.find((v) => v.turno === "manha")!;
  ok(manha.ocupadas === 3 && manha.bloqueio === "lotado" && manha.livres === 0, `turno lota em 3/3 (${manha.ocupadas}/${manha.capacidade}, ${manha.bloqueio})`);

  // 2) a 4a e recusada
  let recusou = "";
  try {
    await agenda.marcar({ provedorId: prov.id, sgpOsId: "OS-4", dia: diaUtil, turno: "manha", origem: "isphub" });
  } catch (e) { recusou = (e as Error).message; }
  ok(recusou.includes("lotado"), `4a marcacao recusada: "${recusou}"`);

  // 3) a tarde do mesmo dia continua livre
  const tarde = g.find((v) => v.turno === "tarde")!;
  ok(tarde.bloqueio === null && tarde.livres === 3, "tarde do mesmo dia segue livre");

  // 4) teto regional barra com vaga global sobrando
  await agenda.marcar({ provedorId: prov.id, sgpOsId: "R-1", dia: diaUtil, turno: "tarde", regiao: "Bela Vista", origem: "isphub" });
  await agenda.marcar({ provedorId: prov.id, sgpOsId: "R-2", dia: diaUtil, turno: "tarde", regiao: "Bela Vista", origem: "isphub" });
  let recusouRegiao = "";
  try {
    await agenda.marcar({ provedorId: prov.id, sgpOsId: "R-3", dia: diaUtil, turno: "tarde", regiao: "Bela Vista", origem: "isphub" });
  } catch (e) { recusouRegiao = (e as Error).message; }
  ok(recusouRegiao.includes("regiao") || recusouRegiao.includes("regi"), `teto regional barra com 1 vaga global sobrando: "${recusouRegiao}"`);
  const outroBairro = await agenda.marcar({ provedorId: prov.id, sgpOsId: "R-4", dia: diaUtil, turno: "tarde", regiao: "Ponta Negra", origem: "isphub" });
  ok(!!outroBairro.id, "outro bairro ainda cabe na mesma tarde");

  // 5) CONCORRENCIA: 8 marcacoes paralelas numa unica vaga
  const diaLivre = agenda.somarDias(diaUtil, 1);
  const dl = agenda.diaDaSemana(diaLivre) === 0 ? agenda.somarDias(diaLivre, 1) : diaLivre;
  await agenda.salvarConfig({ vagasManha: 1, tetoRegiao: null });
  const r = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      agenda.marcar({ provedorId: prov.id, sgpOsId: `C-${i}`, dia: dl, turno: "manha", origem: "isphub" }),
    ),
  );
  const passaram = r.filter((x) => x.status === "fulfilled").length;
  ok(passaram === 1, `8 marcacoes paralelas na ultima vaga -> ${passaram} passou (esperado 1)`);

  // 6) remarcar pra MESMA janela nao se auto-recusa
  const alvo = (r.find((x) => x.status === "fulfilled") as PromiseFulfilledResult<{ id: string; sgpOsId: string }>).value;
  const rem = await agenda.marcar({ provedorId: prov.id, sgpOsId: alvo.sgpOsId, dia: dl, turno: "manha", origem: "isphub" });
  ok(rem.id === alvo.id, "remarcar pra mesma janela atualiza a linha, nao compete consigo mesma");

  // 7) desmarcar devolve a vaga
  await agenda.cancelar(alvo.id);
  g = await agenda.grade({ de: dl, ate: dl });
  ok(g.find((v) => v.turno === "manha")!.livres === 1, "desmarcar devolve a vaga pra grade");

  // 8) reconciliacao do que foi agendado direto no SGP
  const os = await prisma.ordemServico.create({
    data: { provedorId: prov.id, sgpOsId: "SGP-99", dataAgendamento: new Date(`${dl}T18:00:00.000Z`), pop: "Macaiba" },
  });
  const criadas = await agenda.reconciliarDoSgp([
    { provedorId: prov.id, sgpOsId: "SGP-99", ordemServicoId: os.id, dataAgendamento: os.dataAgendamento!, regiao: os.pop },
  ]);
  const denovo = await agenda.reconciliarDoSgp([
    { provedorId: prov.id, sgpOsId: "SGP-99", ordemServicoId: os.id, dataAgendamento: os.dataAgendamento!, regiao: os.pop },
  ]);
  ok(criadas === 1 && denovo === 0, `OS agendada no SGP entra na grade e nao duplica (${criadas} depois ${denovo})`);
  const marcada = await prisma.agendamento.findFirst({ where: { sgpOsId: "SGP-99" } });
  ok(marcada?.turno === "tarde", `18h UTC = 15h em Natal -> turno "${marcada?.turno}" (esperado tarde)`);

  // 9) orfa: marcada antes de a OS existir, ligada quando o sync a traz
  const dOrfa = agenda.somarDias(dl, 2);
  const du = agenda.diaDaSemana(dOrfa) === 0 ? agenda.somarDias(dOrfa, 1) : dOrfa;
  const orfa = await agenda.marcar({ provedorId: prov.id, sgpOsId: "NOVA-1", dia: du, turno: "manha", origem: "atendai_ia" });
  ok(orfa.ordemServicoId === null, "marcacao aceita ANTES de a OS existir no espelho (a corrida do atendimento)");
  await prisma.ordemServico.create({ data: { provedorId: prov.id, sgpOsId: "NOVA-1" } });
  const ligadas = await agenda.ligarOrfas(prov.id);
  const agoraLigada = await prisma.agendamento.findUnique({ where: { id: orfa.id } });
  ok(ligadas === 1 && agoraLigada?.ordemServicoId !== null, "sync liga a orfa na OS espelhada");

  // 10) teto do DIA: fecha os dois turnos, mesmo com turno vazio
  const dDia = agenda.somarDias(du, 2);
  const dd = agenda.diaDaSemana(dDia) === 0 ? agenda.somarDias(dDia, 1) : dDia;
  await agenda.salvarConfig({ vagasManha: 10, vagasTarde: 10, vagasDia: 3 });
  for (let i = 0; i < 3; i++) {
    await agenda.marcar({ provedorId: prov.id, sgpOsId: `D-${i}`, dia: dd, turno: "manha", origem: "isphub" });
  }
  let recusouDia = "";
  try {
    await agenda.marcar({ provedorId: prov.id, sgpOsId: "D-tarde", dia: dd, turno: "tarde", origem: "isphub" });
  } catch (e) { recusouDia = (e as Error).message; }
  ok(/Dia lotado/i.test(recusouDia), `teto diario fecha a TARDE vazia com 3/3 no dia: "${recusouDia}"`);
  const gd = await agenda.grade({ de: dd, ate: dd });
  ok(gd.every((v) => v.bloqueio === "dia_lotado"), "os dois turnos reportam 'dia_lotado', nao 'lotado'");

  // 11) as vagas anunciadas sao o MENOR dos dois limites
  const dMenor = agenda.somarDias(dd, 1);
  const dm = agenda.diaDaSemana(dMenor) === 0 ? agenda.somarDias(dMenor, 1) : dMenor;
  await agenda.marcar({ provedorId: prov.id, sgpOsId: "M-1", dia: dm, turno: "manha", origem: "isphub" });
  const gm = await agenda.grade({ de: dm, ate: dm });
  ok(gm.find((v) => v.turno === "tarde")!.livres === 2, `tarde anuncia 2 (teto do dia 3 - 1 usada), nao 10: ${gm.find((v) => v.turno === "tarde")!.livres}`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
