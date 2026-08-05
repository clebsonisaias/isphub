import { Router } from "express";
import { z } from "zod";
import { FORMAS_PAGAMENTO, LANCAMENTO_STATUS, LANCAMENTO_TIPOS, UserRole } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import * as lancamentos from "../services/lancamentoService.js";

export const financeiroRouter = Router();

/**
 * FINANCEIRO DA HUBISP — contas a pagar e a receber da propria empresa.
 *
 * ADMIN only, e a razao nao e "cautela": aqui esta quanto cada provedor paga a
 * hub. Um GESTOR ve a operacao inteira e nao precisa disso; um PROVEDOR entao
 * veria o preco combinado com os CONCORRENTES dele, que estao na mesma tabela.
 *
 * Esta guarda e independente do motor de modulos de proposito. `rolesPermitidos`
 * em /admin/modulos e configuravel — alguem poderia adicionar PROVEDOR ali sem
 * perceber o que isso expoe. A rota recusa de qualquer jeito.
 */
financeiroRouter.use(requireAuth, requireRole(UserRole.ADMIN));

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD");

/** Dinheiro entra como STRING. `z.number()` aqui ja seria o bug. */
const dinheiro = z.string().trim().min(1, "Informe o valor").max(20);

const criarSchema = z.object({
  tipo: z.enum(LANCAMENTO_TIPOS),
  descricao: z.string().trim().min(1, "Informe a descricao").max(200),
  valor: dinheiro,
  vencimento: dataIso,
  competencia: dataIso.optional(),
  provedorId: z.string().uuid().nullish(),
  categoriaId: z.string().uuid().nullish(),
  observacao: z.string().trim().max(500).nullish(),
});

const editarSchema = z.object({
  descricao: z.string().trim().min(1).max(200).optional(),
  valor: dinheiro.optional(),
  vencimento: dataIso.optional(),
  competencia: dataIso.optional(),
  provedorId: z.string().uuid().nullish(),
  categoriaId: z.string().uuid().nullish(),
  observacao: z.string().trim().max(500).nullish(),
});

const baixaSchema = z.object({
  pagoEm: dataIso.optional(),
  valorPago: dinheiro.optional(),
  formaPagamento: z.enum(FORMAS_PAGAMENTO),
  observacao: z.string().trim().max(500).nullish(),
});

const filtroSchema = z.object({
  tipo: z.enum(LANCAMENTO_TIPOS).optional(),
  situacao: z.enum([...LANCAMENTO_STATUS, "atrasado"] as const).optional(),
  provedorId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  de: dataIso.optional(),
  ate: dataIso.optional(),
  busca: z.string().trim().max(100).optional(),
  limite: z.coerce.number().int().min(1).max(lancamentos.LIMITE_PAGINA).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Lancamentos
// ---------------------------------------------------------------------------

financeiroRouter.get(
  "/lancamentos",
  asyncHandler(async (req, res) => {
    const { limite, offset, ...filtro } = filtroSchema.parse(req.query);
    // Lista e resumo no mesmo payload: o cabecalho de totais e a lista SEMPRE
    // falam do mesmo recorte. Em chamadas separadas eles divergem enquanto uma
    // das duas ainda esta no ar, e o numero do topo e justamente o que as
    // pessoas leem primeiro.
    const [lista, resumo] = await Promise.all([
      lancamentos.listar(filtro, limite, offset),
      lancamentos.resumo(filtro),
    ]);
    res.json({ itens: lista.itens, total: lista.total, resumo });
  }),
);

financeiroRouter.get(
  "/lancamentos/:id",
  asyncHandler(async (req, res) => {
    res.json(await lancamentos.obter(req.params.id));
  }),
);

financeiroRouter.get(
  "/lancamentos/:id/historico",
  asyncHandler(async (req, res) => {
    res.json(await lancamentos.historico(req.params.id));
  }),
);

financeiroRouter.post(
  "/lancamentos",
  asyncHandler(async (req, res) => {
    const dados = criarSchema.parse(req.body);
    res.status(201).json(await lancamentos.criar({ ...dados, autorId: req.user!.sub }));
  }),
);

financeiroRouter.patch(
  "/lancamentos/:id",
  asyncHandler(async (req, res) => {
    const dados = editarSchema.parse(req.body);
    res.json(await lancamentos.editar({ ...dados, id: req.params.id, autorId: req.user!.sub }));
  }),
);

financeiroRouter.post(
  "/lancamentos/:id/baixa",
  asyncHandler(async (req, res) => {
    const dados = baixaSchema.parse(req.body);
    res.json(await lancamentos.baixar({ ...dados, id: req.params.id, autorId: req.user!.sub }));
  }),
);

financeiroRouter.delete(
  "/lancamentos/:id/baixa",
  asyncHandler(async (req, res) => {
    res.json(await lancamentos.estornar(req.params.id, req.user!.sub));
  }),
);

const cancelarSchema = z.object({ motivo: z.string().trim().max(200).optional() });

/**
 * Cancelar EXISTE no lugar de excluir. Nao ha `DELETE /lancamentos/:id` nesta
 * API e nao deve haver: registro de dinheiro sai do fluxo, nao do banco — quem
 * cancelou e quando fica gravado no historico.
 */
financeiroRouter.post(
  "/lancamentos/:id/cancelamento",
  asyncHandler(async (req, res) => {
    const { motivo } = cancelarSchema.parse(req.body ?? {});
    res.json(await lancamentos.cancelar(req.params.id, req.user!.sub, motivo));
  }),
);

// ---------------------------------------------------------------------------
// Comprovante
// ---------------------------------------------------------------------------

const MIMES_COMPROVANTE = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const LIMITE_COMPROVANTE_BYTES = 3 * 1024 * 1024;

const comprovanteSchema = z.object({
  arquivoBase64: z.string().min(1),
  mime: z.string().min(1),
  nome: z.string().trim().min(1).max(200),
});

financeiroRouter.put(
  "/lancamentos/:id/comprovante",
  asyncHandler(async (req, res) => {
    const { arquivoBase64, mime, nome } = comprovanteSchema.parse(req.body);
    if (!MIMES_COMPROVANTE.includes(mime)) {
      throw new HttpError(400, "Comprovante deve ser PDF ou imagem (JPEG, PNG ou WebP)");
    }
    const dados = Buffer.from(arquivoBase64, "base64");
    if (dados.byteLength === 0) throw new HttpError(400, "Comprovante vazio");
    if (dados.byteLength > LIMITE_COMPROVANTE_BYTES) {
      throw new HttpError(400, `Comprovante maior que ${LIMITE_COMPROVANTE_BYTES / 1024 / 1024}MB`);
    }

    const existe = await prisma.lancamento.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existe) throw new HttpError(404, "Lancamento nao encontrado");

    await prisma.lancamento.update({
      where: { id: req.params.id },
      data: {
        comprovanteDados: new Uint8Array(dados),
        comprovanteMime: mime,
        comprovanteNome: nome,
        comprovanteTamanho: dados.byteLength,
      },
    });
    res.json(await lancamentos.obter(req.params.id));
  }),
);

financeiroRouter.get(
  "/lancamentos/:id/comprovante",
  asyncHandler(async (req, res) => {
    const row = await prisma.lancamento.findUnique({
      where: { id: req.params.id },
      select: { comprovanteDados: true, comprovanteMime: true, comprovanteNome: true },
    });
    if (!row?.comprovanteDados || !row.comprovanteMime) throw new HttpError(404, "Sem comprovante");
    res.setHeader("Content-Type", row.comprovanteMime);
    // `inline`: comprovante e pra CONFERIR, entao abre no visualizador em vez
    // de baixar. O nome vai junto pra quando a pessoa decidir salvar.
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(row.comprovanteNome ?? "comprovante")}"`);
    // Sem cache: comprovante trocado tem que aparecer trocado.
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(row.comprovanteDados));
  }),
);

financeiroRouter.delete(
  "/lancamentos/:id/comprovante",
  asyncHandler(async (req, res) => {
    await prisma.lancamento.update({
      where: { id: req.params.id },
      data: { comprovanteDados: null, comprovanteMime: null, comprovanteNome: null, comprovanteTamanho: null },
    });
    res.json(await lancamentos.obter(req.params.id));
  }),
);

// ---------------------------------------------------------------------------
// Categorias financeiras
// ---------------------------------------------------------------------------

const categoriaSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome").max(80),
  tipo: z.enum(LANCAMENTO_TIPOS),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor deve ser hexadecimal (#rrggbb)").optional(),
  ativo: z.boolean().optional(),
});

financeiroRouter.get(
  "/categorias",
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.categoriaFinanceira.findMany({
        orderBy: [{ tipo: "asc" }, { nome: "asc" }],
        select: { id: true, nome: true, tipo: true, cor: true, ativo: true },
      }),
    );
  }),
);

financeiroRouter.post(
  "/categorias",
  asyncHandler(async (req, res) => {
    const dados = categoriaSchema.parse(req.body);
    const existente = await prisma.categoriaFinanceira.findUnique({ where: { nome: dados.nome } });
    if (existente) throw new HttpError(409, "Ja existe uma categoria com esse nome");
    res.status(201).json(
      await prisma.categoriaFinanceira.create({
        data: dados,
        select: { id: true, nome: true, tipo: true, cor: true, ativo: true },
      }),
    );
  }),
);

financeiroRouter.patch(
  "/categorias/:id",
  asyncHandler(async (req, res) => {
    const dados = categoriaSchema.partial().parse(req.body);
    res.json(
      await prisma.categoriaFinanceira.update({
        where: { id: req.params.id },
        data: dados,
        select: { id: true, nome: true, tipo: true, cor: true, ativo: true },
      }),
    );
  }),
);
