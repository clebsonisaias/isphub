import type { EstadoIgnicao } from "@prisma/client";
import { OsStatus, deveFazerCheckin } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { mudarStatus } from "./writebackService.js";

/**
 * CHECK-IN AUTOMATICO — a viatura parou perto do endereco da OS que o tecnico
 * marcou como "a caminho": a OS vira "em execucao" sozinha.
 *
 * So de `em_deslocamento`. O tecnico ja disse pra onde ia; o sistema adianta
 * um toque que ele daria. Nunca mexe em OS `aberta` — ali ninguem disse nada.
 *
 * O autor da mudanca de status e o TECNICO (ocupante da viatura), como se ele
 * tivesse apertado; uma anotacao sem autor registra que foi automatico e a que
 * distancia. Assim o BI de produtividade continua creditando a visita a quem
 * fez, e a timeline conta a historia inteira.
 */
export async function checkinAutomatico(
  leitura: { veiculoId: string; lat: number; lng: number; velocidadeKmh: number | null; ignicao: EstadoIgnicao | null; registradoEm: Date },
  raioMetros: number,
): Promise<number> {
  if (raioMetros <= 0) return 0;

  const ocupacao = await prisma.ocupacaoVeiculo.findFirst({
    where: { veiculoId: leitura.veiculoId, fimEm: null, papel: "motorista" },
    select: { usuarioId: true },
  });
  if (!ocupacao) return 0;

  const aCaminho = await prisma.ordemServico.findMany({
    where: { tecnicoId: ocupacao.usuarioId, status: OsStatus.EM_DESLOCAMENTO, lat: { not: null }, lng: { not: null } },
    select: { id: true, sgpOsId: true, lat: true, lng: true },
  });

  let feitos = 0;
  for (const os of aCaminho) {
    const r = deveFazerCheckin({
      ponto: { lat: leitura.lat, lng: leitura.lng, velocidadeKmh: leitura.velocidadeKmh, ignicao: leitura.ignicao as never },
      destino: { lat: os.lat!, lng: os.lng! },
      raioMetros,
    });
    if (!r.sim) continue;
    try {
      await mudarStatus(os.id, OsStatus.EM_EXECUCAO, ocupacao.usuarioId, { lat: leitura.lat, lng: leitura.lng });
      await prisma.osEvento.create({
        data: {
          ordemServicoId: os.id,
          tipo: "anotacao",
          autorId: null,
          descricao: `Check-in automático: a viatura parou a ${r.distanciaMetros} m do endereço (${leitura.registradoEm.toISOString().slice(11, 16)} UTC).`,
          lat: leitura.lat,
          lng: leitura.lng,
        },
      });
      feitos += 1;
    } catch (e) {
      // SGP fora do ar nao pode calar a coleta; o tecnico ainda tem o botao.
      console.warn(`[checkin] OS ${os.sgpOsId}: nao deu pra marcar em execucao:`, e);
    }
  }
  return feitos;
}
