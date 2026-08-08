import { z } from "zod";
import type { RastreadorConnector, RastreadorFornecedor } from "@isphub/shared";
import type { Prisma } from "@prisma/client";
import { createPlataformaTkConnector } from "../connectors/plataformatk.js";
import { decrypt, encrypt, maskToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { validarUrlExterna } from "../lib/urlValidation.js";
import { HttpError } from "../middleware/errorHandler.js";

/**
 * Rastreadores, credencial do fornecedor e o vinculo com o veiculo.
 *
 * A tela NUNCA fala com a PlataformaTK — fala com `Rastreador`. Trocar de
 * fornecedor e escrever outro conector e acrescentar um `case` aqui.
 */

/** Espelha `erpConnectorService.buildConnector`: decifra e escolhe o conector. */
export function buildRastreadorConnector(config: {
  fornecedor: RastreadorFornecedor;
  baseUrl: string;
  chaveCifrada: string;
}): RastreadorConnector {
  const chave = decrypt(config.chaveCifrada);
  switch (config.fornecedor) {
    case "plataformatk":
      return createPlataformaTkConnector({ baseUrl: config.baseUrl, chave });
    default:
      throw new Error(`Fornecedor de rastreamento nao suportado: ${config.fornecedor}`);
  }
}

// ---------------------------------------------------------------------------
// CONFIG (credencial)
// ---------------------------------------------------------------------------

/**
 * `provedorId` nulo = a conta da propria operacao ISPhub.
 *
 * Os dois indices parciais garantem uma config por provedor E exatamente uma da
 * hub — um unique comum aceitaria N da hub, porque o Postgres trata NULL como
 * distinto.
 */
export async function obterConfig(provedorId: string | null) {
  const c = await prisma.rastreadorConfig.findFirst({
    where: { provedorId, fornecedor: "plataformatk" },
  });
  if (!c) return null;
  let chaveMascarada = "(ilegivel)";
  try {
    chaveMascarada = maskToken(decrypt(c.chaveCifrada));
  } catch {
    // Chave cifrada com outra CRYPTO_KEY: mostra que existe, sem quebrar a tela.
  }
  return {
    id: c.id,
    provedorId: c.provedorId,
    fornecedor: c.fornecedor,
    baseUrl: c.baseUrl,
    chaveMascarada,
    intervaloPollingSegundos: c.intervaloPollingSegundos,
    ativo: c.ativo,
    ultimaColetaEm: c.ultimaColetaEm?.toISOString() ?? null,
    ultimaColetaOk: c.ultimaColetaOk,
    ultimaColetaMensagem: c.ultimaColetaMensagem,
  };
}

export async function salvarConfig(args: {
  provedorId: string | null;
  chave: string;
  baseUrl?: string;
  intervaloPollingSegundos?: number;
  ativo?: boolean;
}) {
  /*
   * Guarda de SSRF: a base e configuravel, entao e entrada do usuario.
   * `validarUrlExterna` e um refinamento de zod (recebe o ctx), entao o uso
   * correto e dentro do schema — nao uma chamada solta.
   */
  const baseUrl = z
    .string()
    .superRefine(validarUrlExterna)
    .parse(args.baseUrl?.trim() || "https://api.plataformatk.com.br");

  // Sempre RE-CIFRA. Guardar em claro, nem por um instante, nao acontece.
  const chaveCifrada = encrypt(args.chave);
  const existente = await prisma.rastreadorConfig.findFirst({
    where: { provedorId: args.provedorId, fornecedor: "plataformatk" },
    select: { id: true },
  });

  const dados = {
    baseUrl,
    chaveCifrada,
    intervaloPollingSegundos: args.intervaloPollingSegundos ?? 60,
    ativo: args.ativo ?? true,
  };

  if (existente) {
    await prisma.rastreadorConfig.update({ where: { id: existente.id }, data: dados });
  } else {
    await prisma.rastreadorConfig.create({
      data: { ...dados, provedorId: args.provedorId, fornecedor: "plataformatk" },
    });
  }
  return obterConfig(args.provedorId);
}

export async function testarConfig(provedorId: string | null) {
  const c = await prisma.rastreadorConfig.findFirst({ where: { provedorId, fornecedor: "plataformatk" } });
  if (!c) throw new HttpError(404, "Nenhuma credencial de rastreamento configurada");
  const r = await buildRastreadorConnector(c).testarConexao();
  await prisma.rastreadorConfig.update({
    where: { id: c.id },
    data: { ultimaColetaOk: r.ok, ultimaColetaMensagem: r.mensagem ?? null },
  });
  return r;
}

// ---------------------------------------------------------------------------
// RASTREADOR
// ---------------------------------------------------------------------------

const SELECT = {
  id: true,
  provedorId: true,
  fornecedor: true,
  identificadorExterno: true,
  apelido: true,
  ativo: true,
  ultimaPosicaoEm: true,
  comunicando: true,
  rastreando: true,
  vinculos: {
    where: { fimEm: null },
    select: { id: true, inicioEm: true, veiculo: { select: { id: true, placa: true, modelo: true } } },
  },
} satisfies Prisma.RastreadorSelect;

export async function listarRastreadores() {
  const linhas = await prisma.rastreador.findMany({ orderBy: { identificadorExterno: "asc" }, select: SELECT });
  return linhas.map((r) => ({
    id: r.id,
    provedorId: r.provedorId,
    fornecedor: r.fornecedor,
    identificadorExterno: r.identificadorExterno,
    apelido: r.apelido,
    ativo: r.ativo,
    ultimaPosicaoEm: r.ultimaPosicaoEm?.toISOString() ?? null,
    comunicando: r.comunicando,
    rastreando: r.rastreando,
    veiculo: r.vinculos[0]?.veiculo ?? null,
    vinculadoEm: r.vinculos[0]?.inicioEm.toISOString() ?? null,
  }));
}

export async function criarRastreador(args: { identificadorExterno: string; apelido?: string | null; provedorId?: string | null }) {
  const id = args.identificadorExterno.trim();
  if (!id) throw new HttpError(400, "Informe o identificador do rastreador no fornecedor");
  try {
    return await prisma.rastreador.create({
      data: { identificadorExterno: id, apelido: args.apelido?.trim() || null, provedorId: args.provedorId ?? null },
      select: { id: true },
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      throw new HttpError(409, `O rastreador ${id} ja esta cadastrado`);
    }
    throw e;
  }
}

/**
 * Vincula rastreador a veiculo — fechando o periodo anterior dos DOIS lados.
 *
 * Isto e o "historico do rastreador": trocar o aparelho de carro nao pode apagar
 * de onde o carro esteve com o anterior. A origem guardava
 * `fleet_vehicles.ptk_tracker_id`, uma coluna que APAGA toda associacao anterior
 * no instante em que muda.
 *
 * Tudo numa transacao: no meio, os dois indices parciais recusariam.
 */
export async function vincular(rastreadorId: string, veiculoId: string, criadoPorId: string) {
  return prisma.$transaction(async (tx) => {
    const [r, v] = await Promise.all([
      tx.rastreador.findUnique({ where: { id: rastreadorId }, select: { id: true } }),
      tx.veiculo.findUnique({ where: { id: veiculoId }, select: { id: true } }),
    ]);
    if (!r) throw new HttpError(404, "Rastreador nao encontrado");
    if (!v) throw new HttpError(404, "Veiculo nao encontrado");

    const agora = new Date();
    await tx.vinculoRastreador.updateMany({
      where: { OR: [{ rastreadorId }, { veiculoId }], fimEm: null },
      data: { fimEm: agora },
    });
    return tx.vinculoRastreador.create({
      data: { rastreadorId, veiculoId, criadoPorId },
      select: { id: true, inicioEm: true },
    });
  });
}

export async function desvincular(rastreadorId: string) {
  const { count } = await prisma.vinculoRastreador.updateMany({
    where: { rastreadorId, fimEm: null },
    data: { fimEm: new Date() },
  });
  if (count === 0) throw new HttpError(409, "Este rastreador nao esta vinculado a nenhum veiculo");
}

/** Historico de vinculos — a resposta de "onde esse aparelho ja esteve". */
export async function historicoVinculos(rastreadorId: string) {
  const linhas = await prisma.vinculoRastreador.findMany({
    where: { rastreadorId },
    orderBy: { inicioEm: "desc" },
    select: { id: true, inicioEm: true, fimEm: true, veiculo: { select: { placa: true, modelo: true } } },
  });
  return linhas.map((l) => ({
    id: l.id,
    inicioEm: l.inicioEm.toISOString(),
    fimEm: l.fimEm?.toISOString() ?? null,
    veiculoPlaca: l.veiculo.placa,
    veiculoModelo: l.veiculo.modelo,
  }));
}
