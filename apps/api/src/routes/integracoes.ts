import { Router } from "express";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import {
  consultarCep,
  listarUfs,
  listarMunicipios,
  listarFeriados,
} from "../integrations/index.js";

export const integracoesRouter = Router();

// Todas as rotas de integracao exigem autenticacao
integracoesRouter.use(requireAuth);

/**
 * Consulta CEP com estrategia de alta disponibilidade:
 * BrasilAPI v2 (primario, com coordenadas) -> ViaCEP (fallback resiliente) -> Cache
 */
integracoesRouter.get(
  "/cep/:cep",
  asyncHandler(async (req, res) => {
    const rawCep = req.params.cep ?? "";
    const cepLimpo = rawCep.replace(/\D/g, "");

    if (cepLimpo.length !== 8) {
      throw new HttpError(400, "CEP deve conter exatamente 8 dígitos numéricos");
    }

    const resultado = await consultarCep(cepLimpo);
    if (!resultado) {
      throw new HttpError(404, "CEP não encontrado");
    }

    res.json({
      ok: true,
      ...resultado,
    });
  }),
);

/**
 * Lista UFs oficiais do Brasil via IBGE com cache de 14 dias
 */
integracoesRouter.get(
  "/ibge/ufs",
  asyncHandler(async (_req, res) => {
    const ufs = await listarUfs();
    res.json({
      ok: true,
      ufs,
    });
  }),
);

/**
 * Lista municípios de uma UF específica via IBGE com cache de 14 dias
 */
integracoesRouter.get(
  "/ibge/municipios/:uf",
  asyncHandler(async (req, res) => {
    const uf = req.params.uf ?? "";
    if (uf.trim().length !== 2) {
      throw new HttpError(400, "UF deve conter 2 letras (ex: RN, PB, SP)");
    }

    const municipios = await listarMunicipios(uf);
    res.json({
      ok: true,
      uf: uf.toUpperCase(),
      municipios,
    });
  }),
);

/**
 * Lista feriados nacionais do ano via BrasilAPI com cache de 30 dias
 */
integracoesRouter.get(
  "/feriados/:ano",
  asyncHandler(async (req, res) => {
    const ano = Number.parseInt(req.params.ano ?? "", 10);
    if (Number.isNaN(ano) || ano < 2000 || ano > 2100) {
      throw new HttpError(400, "Ano inválido");
    }

    const feriados = await listarFeriados(ano);
    res.json({
      ok: true,
      ano,
      feriados,
    });
  }),
);
