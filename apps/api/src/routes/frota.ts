import { Router } from "express";
import { z } from "zod";
import { STATUS_VEICULO, TIPOS_VEICULO, UserRole } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { escopoVeiculoWhere, podeAcessarVeiculo } from "../services/escopoService.js";
import * as veiculos from "../services/veiculoService.js";

/**
 * Modulo Frota — o angulo OPERACIONAL do veiculo.
 *
 * Router PROPRIO, e nao mais rotas sob /financeiro, por uma razao concreta:
 * `routes/financeiro.ts` tem um `requireRole(UserRole.ADMIN)` no topo,
 * deliberadamente independente do motor de modulos. Frota precisa de GESTOR
 * tambem — quem despacha e quem precisa saber onde estao as viaturas. Pendurar
 * aqui evita afrouxar aquela guarda, que protege dinheiro.
 *
 * `/financeiro/frota/*` continua exatamente como estava.
 */
export const frotaRouter = Router();

frotaRouter.use(requireAuth);

const rolesLeitura = [UserRole.ADMIN, UserRole.GESTOR] as const;

const veiculoBase = {
  modelo: z.string().trim().min(1).max(80),
  marca: z.string().trim().max(60).nullish(),
  ano: z.number().int().min(1900).max(2100).nullish(),
  cor: z.string().trim().max(30).nullish(),
  tipo: z.enum(TIPOS_VEICULO).optional(),
  provedorId: z.string().uuid().nullish(),
  odometroKm: z.number().int().min(0).max(9_999_999).nullish(),
  renavam: z.string().trim().max(20).nullish(),
  chassi: z.string().trim().max(17).nullish(),
};

/*
 * `placa` entra como string livre, sem regex: "abc-1234" e digitacao valida do
 * usuario. Quem decide se e placa e o service, DEPOIS de normalizar — uma regex
 * aqui rejeitaria a forma que a pessoa naturalmente digita.
 */
const criarSchema = z.object({ placa: z.string().trim().min(1).max(10), ...veiculoBase });
const editarSchema = z.object({ ...veiculoBase, status: z.enum(STATUS_VEICULO).optional() }).partial();

frotaRouter.get(
  "/veiculos",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    const provedorId = typeof req.query.provedorId === "string" ? req.query.provedorId : undefined;
    res.json(await veiculos.listar(escopoVeiculoWhere(req.user!, provedorId)));
  }),
);

frotaRouter.post(
  "/veiculos",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    res.status(201).json(await veiculos.criar(criarSchema.parse(req.body)));
  }),
);

/** Carrega e confere o acesso — 404 quando nao existe, 403 quando e de outro dono. */
async function assertAcesso(req: Parameters<Parameters<typeof asyncHandler>[0]>[0], id: string) {
  const v = await veiculos.obter(id);
  if (!v) throw new HttpError(404, "Veiculo nao encontrado");
  if (!podeAcessarVeiculo(req.user!, v)) throw new HttpError(403, "Veiculo de outro provedor");
  return v;
}

frotaRouter.get(
  "/veiculos/:id",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    res.json(veiculos.serializarVeiculo((await veiculos.obter(req.params.id))!));
  }),
);

frotaRouter.patch(
  "/veiculos/:id",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    res.json(await veiculos.editar(req.params.id, editarSchema.parse(req.body)));
  }),
);
