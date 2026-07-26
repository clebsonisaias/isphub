import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const horaRouter = Router();

horaRouter.use(requireAuth);

/**
 * Fuso da matriz da empresa (Natal/RN) — America/Fortaleza cobre CE/RN/PB e
 * nunca teve horario de verao no Brasil pos-2019, entao o offset e sempre
 * fixo (-03:00). Usado pra reconstruir o instante UTC a partir da resposta
 * da timeapi.io sem depender de parsing de string com fuso.
 */
const TIMEZONE = "America/Fortaleza";
const CIDADE = "Natal, RN";
const OFFSET_MS = 3 * 60 * 60 * 1000;
const CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 4_000;

interface HoraCache {
  /** Instante de rede (epoch ms) no momento em que foi capturado. */
  redeMs: number;
  /** Date.now() local no momento da captura, pra extrapolar o quanto passou. */
  capturadoEmMs: number;
  fonte: "rede" | "servidor";
}

let cache: HoraCache | null = null;

/** Busca a hora atual em Fortaleza via API publica (timeapi.io); null se falhar. */
async function buscarHoraRede(): Promise<number | null> {
  try {
    const res = await fetch(`https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(TIMEZONE)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { year?: number; month?: number; day?: number; hour?: number; minute?: number; seconds?: number };
    if (
      typeof data.year !== "number" ||
      typeof data.month !== "number" ||
      typeof data.day !== "number" ||
      typeof data.hour !== "number" ||
      typeof data.minute !== "number" ||
      typeof data.seconds !== "number"
    ) {
      return null;
    }
    return Date.UTC(data.year, data.month - 1, data.day, data.hour, data.minute, data.seconds) + OFFSET_MS;
  } catch {
    return null;
  }
}

/**
 * Hora atual de Natal/RN, com cache de 60s pra nao bater na API externa a
 * cada usuario com o cabecalho aberto. Se a rede falhar, cai pro relogio do
 * proprio servidor (ainda correto na pratica, so nao "verificado pela rede").
 */
horaRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const agora = Date.now();
    if (!cache || agora - cache.capturadoEmMs > CACHE_MS) {
      const redeMs = await buscarHoraRede();
      cache = redeMs !== null ? { redeMs, capturadoEmMs: agora, fonte: "rede" } : { redeMs: agora, capturadoEmMs: agora, fonte: "servidor" };
    }
    const decorrido = Date.now() - cache.capturadoEmMs;
    res.json({
      isoUtc: new Date(cache.redeMs + decorrido).toISOString(),
      timezone: TIMEZONE,
      cidade: CIDADE,
      fonte: cache.fonte,
    });
  }),
);
