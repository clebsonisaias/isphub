import { Router } from "express";
import { z } from "zod";
import { PAPEIS_OCUPACAO, TURNOS_AGENDA, UserRole, type JornadaResposta, type TecnicoEmJornada } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { prisma } from "../lib/prisma.js";
import { podeAcessarVeiculo } from "../services/escopoService.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as escala from "../services/escalaService.js";
import { registrarChecklist } from "../services/checklistService.js";
import { ocupacaoAtual } from "../services/ocupacaoService.js";
import {
  encerrarJornada,
  iniciarJornada,
  jornadaAtual,
  jornadasAtivas,
  trocarViatura,
  type ResultadoJornada,
  pausarJornada,
  retomarJornada,
} from "../services/jornadaService.js";

/**
 * Jornada do tecnico — marcador operacional de turno.
 *
 * Rota fina: toda a regra (idempotencia, acoplamento com o status do perfil,
 * corrida no INSERT) mora em `jornadaService`, que tem teste. Aqui so entra
 * validacao de entrada e o escopo por papel.
 */
export const jornadaRouter = Router();

jornadaRouter.use(requireAuth);

/**
 * Coordenada do momento. **Opcional de proposito**: permissao de localizacao
 * negada nao pode impedir alguem de bater o inicio do turno — a jornada e o
 * dado principal, a posicao e um complemento.
 */
const geoSchema = z.object({
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

/**
 * `agoraServidor` acompanha TODA resposta.
 *
 * O cronometro do app e `agora - inicioEm`, e `inicioEm` foi carimbado por este
 * relogio. Se o app medisse com o relogio do aparelho, um celular desacertado
 * mostraria um "tempo trabalhado" errado — justamente o numero que o tecnico
 * confere. Mandando junto, os dois carimbos saem da mesma fonte e na mesma
 * resposta, sem requisicao extra.
 */
function resposta(jornada: JornadaResposta["jornada"]): JornadaResposta {
  return { jornada, agoraServidor: new Date().toISOString() };
}

/**
 * Resposta com viatura. Cresce ADITIVAMENTE sobre `JornadaResposta` — o app e a
 * web que ainda nao conhecem `ocupacao`/`avisos` continuam compilando e
 * funcionando, so ignoram os campos novos.
 */
function respostaComViatura(r: ResultadoJornada) {
  return { ...resposta(r.jornada), ocupacao: r.ocupacao, avisos: r.avisos };
}

/**
 * Viatura na abertura do turno. TODOS os campos opcionais: quem foi a pe abre
 * a jornada igual — mesma regra do geo.
 */
const viaturaSchema = z.object({
  veiculoId: z.string().uuid().nullish(),
  papel: z.enum(PAPEIS_OCUPACAO).optional(),
  odometro: z.number().int().min(0).max(9_999_999).nullish(),
  // Teto de 6: e um carro. Array sem teto e amplificacao de escrita.
  colegas: z
    .array(z.object({ usuarioId: z.string().uuid(), papel: z.enum(PAPEIS_OCUPACAO).default("passageiro") }))
    .max(6)
    .optional(),
});

/** Checklist da viatura (saida/retorno). Tudo opcional: o turno abre igual sem ele. */
const checklistSchema = z
  .object({
    combustivelPct: z.number().int().min(0).max(100).nullish(),
    avarias: z.string().trim().max(400).nullish(),
    // ~1 MB em base64 = 1,4 M chars; o service confere os bytes reais.
    fotoPainel: z.string().max(1_500_000).nullish(),
    fotoMime: z.enum(["image/jpeg", "image/png", "image/webp"]).nullish(),
  })
  .nullish();

jornadaRouter.get(
  "/atual",
  asyncHandler(async (req, res) => {
    res.json(resposta(await jornadaAtual(req.user!.sub)));
  }),
);

jornadaRouter.post(
  "/iniciar",
  asyncHandler(async (req, res) => {
    const corpo = req.body ?? {};
    const geo = geoSchema.parse(corpo);
    const viatura = viaturaSchema.parse(corpo);
    const cl = checklistSchema.parse(corpo.checklist);
    const r = await iniciarJornada(req.user!.sub, geo, viatura);
    // Checklist DEPOIS de a jornada existir e so quando ha viatura: falhar na
    // foto nao pode impedir o turno de abrir.
    if (r.ocupacao && (viatura.odometro != null || cl)) {
      await registrarChecklist({ ocupacaoId: r.ocupacao.id, momento: "saida", odometroKm: viatura.odometro, geo, checklist: cl }).catch((e) =>
        console.warn("[jornada] checklist de saida nao gravado:", e),
      );
    }
    res.json(respostaComViatura(r));
  }),
);

/**
 * Troca de viatura no MEIO do turno — o tecnico que muda de carro as 13:30.
 *
 * A jornada nao e tocada; o que muda e a ocupacao. O historico fica com dois
 * trechos em vez de o segundo sobrescrever o primeiro.
 */
jornadaRouter.patch(
  "/veiculo",
  asyncHandler(async (req, res) => {
    const corpo = req.body ?? {};
    const geo = geoSchema.parse(corpo);
    const viatura = viaturaSchema.parse(corpo);
    res.json(respostaComViatura(await trocarViatura(req.user!.sub, geo, viatura)));
  }),
);

jornadaRouter.post(
  "/encerrar",
  asyncHandler(async (req, res) => {
    const corpo = req.body ?? {};
    const geo = geoSchema.parse(corpo);
    const { odometro } = z.object({ odometro: z.number().int().min(0).max(9_999_999).nullish() }).parse(corpo);
    const cl = checklistSchema.parse(corpo.checklist);
    // A ocupacao aberta ANTES de encerrar: depois ela ja fechou e nao ha como acha-la.
    const ocupacao = await ocupacaoAtual(req.user!.sub);
    const j = await encerrarJornada(req.user!.sub, geo, odometro);
    if (ocupacao && (odometro != null || cl)) {
      await registrarChecklist({ ocupacaoId: ocupacao.id, momento: "retorno", odometroKm: odometro, geo, checklist: cl }).catch((e) =>
        console.warn("[jornada] checklist de retorno nao gravado:", e),
      );
    }
    res.json(resposta(j));
  }),
);

const pausaSchema = z.object({ motivo: z.enum(["almoco", "outro"]).default("almoco") });

/**
 * Pausar e retomar. Sao do PROPRIO tecnico (`req.user.sub`), como iniciar e
 * encerrar: quem para pra almocar e quem esta parado.
 */
jornadaRouter.post(
  "/pausar",
  asyncHandler(async (req, res) => {
    const { motivo } = pausaSchema.parse(req.body ?? {});
    res.json(resposta(await pausarJornada(req.user!.sub, motivo)));
  }),
);

jornadaRouter.post(
  "/retomar",
  asyncHandler(async (req, res) => {
    res.json(resposta(await retomarJornada(req.user!.sub)));
  }),
);

/**
 * O que FOI ESCALADO pra mim hoje. Leitura pura: o app mostra, nao escolhe.
 *
 * Do proprio usuario (`req.user.sub`), sem parametro — a ausencia do parametro
 * E a garantia, nao uma checagem que alguem pode esquecer de fazer.
 */
jornadaRouter.get(
  "/escala",
  asyncHandler(async (req, res) => {
    res.json(await escala.escalaDoTecnico(req.user!.sub, new Date()));
  }),
);

const diaSchema = z.object({ dia: z.string().date().optional() });
const escalarSchema = z.object({
  usuarioId: z.string().uuid(),
  dia: z.string().date(),
  /** Nulo = escalado A PE. Diferente de nao escalado, que e nao ter linha. */
  veiculoId: z.string().uuid().nullable(),
  papel: z.enum(PAPEIS_OCUPACAO).default("motorista"),
  /** Dia inteiro por padrao; meio periodo = um so. */
  turnos: z.array(z.enum(TURNOS_AGENDA)).min(1).max(2).default(["manha", "tarde"]),
});

/** O quadro do dia — a tela do supervisor. */
jornadaRouter.get(
  "/escalas",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { dia } = diaSchema.parse(req.query);
    res.json(await escala.escalaDoDia(dia ? new Date(`${dia}T00:00:00Z`) : new Date()));
  }),
);

/** Escala (ou reescala) um tecnico. Upsert: mexer no dia atualiza a linha. */
jornadaRouter.put(
  "/escalas",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const b = escalarSchema.parse(req.body);
    if (b.veiculoId) {
      // Gestor limitado so escala em viatura do escopo dele (ou da hub).
      const v = await prisma.veiculo.findUnique({ where: { id: b.veiculoId }, select: { provedorId: true } });
      if (v && !podeAcessarVeiculo(req.user!, v)) throw new HttpError(403, "Veiculo de outro provedor");
    }
    await escala.escalar({
      usuarioId: b.usuarioId,
      dia: new Date(`${b.dia}T00:00:00Z`),
      veiculoId: b.veiculoId,
      papel: b.papel,
      turnos: b.turnos,
      definidoPor: req.user!.sub,
    });
    res.json(await escala.escalaDoDia(new Date(`${b.dia}T00:00:00Z`)));
  }),
);

/** Faltou / voltou. Devolve o quadro do dia. */
jornadaRouter.post(
  "/escalas/:usuarioId/ausencia",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const b = z
      .object({ dia: z.string().date(), ausente: z.boolean(), motivo: z.string().trim().max(120).nullish() })
      .parse(req.body);
    const d = new Date(`${b.dia}T00:00:00Z`);
    await escala.marcarAusencia({ usuarioId: req.params.usuarioId, dia: d, ausente: b.ausente, motivo: b.motivo });
    res.json(await escala.escalaDoDia(d));
  }),
);

jornadaRouter.delete(
  "/escalas/:usuarioId",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (req, res) => {
    const { dia } = diaSchema.parse(req.query);
    const d = dia ? new Date(`${dia}T00:00:00Z`) : new Date();
    await escala.desescalar(req.params.usuarioId, d);
    res.json(await escala.escalaDoDia(d));
  }),
);

/**
 * Quem esta em servico agora — tela do gestor.
 *
 * Restrita a ADMIN/GESTOR: e informacao sobre a jornada de OUTRAS pessoas.
 * Um tecnico ve a propria por `/atual`, e nao tem porque enxergar a dos colegas.
 */
jornadaRouter.get(
  "/ativas",
  requireRole(UserRole.ADMIN, UserRole.GESTOR),
  asyncHandler(async (_req, res) => {
    const ativas: TecnicoEmJornada[] = await jornadasAtivas();
    res.json(ativas);
  }),
);
