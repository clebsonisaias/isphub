import { limitesDoDia, resumirDia, type HistoricoDoDia, type ViagemDoDia } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { historicoDoVeiculo, type OcupacaoPublic } from "./ocupacaoService.js";

/**
 * O HISTORICO DE UM DIA do veiculo: viagens com quem dirigia, paradas entre
 * elas e os totais. O trajeto vem a parte (`rastreamento.trilha`) porque e o
 * pedaco pesado e o mapa pode carrega-lo depois.
 */

/**
 * Quem dirigia no instante — o MOTORISTA cuja ocupacao cobre o instante.
 *
 * Fallback de `Viagem.ocupacaoId`: a viagem so guarda a ocupacao quando havia
 * alguem declarado NO MOMENTO em que ela abriu. Se o gestor corrigiu depois
 * (ajuste), ou o tecnico declarou 2 min apos ligar o carro, a ocupacao existe
 * mas a viagem nao aponta pra ela. Intervalo semiaberto `[inicio, fim)`.
 */
export function motoristaNoInstante(ocupacoes: OcupacaoPublic[], instante: Date): string | null {
  const t = instante.getTime();
  const cobre = (o: OcupacaoPublic) => Date.parse(o.inicioEm) <= t && (o.fimEm == null || Date.parse(o.fimEm) > t);
  const motorista = ocupacoes.find((o) => o.papel === "motorista" && cobre(o));
  return motorista?.usuarioNome ?? null;
}

export async function historicoDoDia(veiculoId: string, dia: string, agora = new Date()): Promise<HistoricoDoDia> {
  const { inicio, fim } = limitesDoDia(dia);

  const [linhas, ocupacoes] = await Promise.all([
    prisma.viagem.findMany({
      // A viagem que atravessa a meia-noite aparece nos DOIS dias: e o que o
      // gestor espera ver ao abrir qualquer um deles.
      where: { veiculoId, inicioEm: { lt: fim }, OR: [{ fimEm: null }, { fimEm: { gte: inicio } }] },
      orderBy: { inicioEm: "asc" },
      select: {
        id: true,
        inicioEm: true,
        fimEm: true,
        latInicio: true,
        lngInicio: true,
        latFim: true,
        lngFim: true,
        distanciaMetros: true,
        velocidadeMaxKmh: true,
        paradoComMotorLigadoSeg: true,
        ocupacao: { select: { usuario: { select: { nome: true, nomeExibicao: true } } } },
      },
    }),
    historicoDoVeiculo(veiculoId, inicio, fim),
  ]);

  const viagens: ViagemDoDia[] = linhas.map((v) => ({
    id: v.id,
    inicioEm: v.inicioEm.toISOString(),
    fimEm: v.fimEm?.toISOString() ?? null,
    latInicio: v.latInicio,
    lngInicio: v.lngInicio,
    latFim: v.latFim,
    lngFim: v.lngFim,
    distanciaMetros: v.distanciaMetros,
    velocidadeMaxKmh: v.velocidadeMaxKmh,
    paradoComMotorLigadoSeg: v.paradoComMotorLigadoSeg,
    motorista: v.ocupacao
      ? v.ocupacao.usuario.nomeExibicao || v.ocupacao.usuario.nome
      : motoristaNoInstante(ocupacoes, v.inicioEm),
  }));

  const resumo = resumirDia(viagens, agora);
  return {
    dia,
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    agoraServidor: agora.toISOString(),
    ...resumo,
  };
}
