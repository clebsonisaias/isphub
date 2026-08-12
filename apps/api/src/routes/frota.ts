import { Router } from "express";
import { z } from "zod";
import { STATUS_VEICULO, TIPOS_VEICULO, UserRole, diaBrasileiro } from "@isphub/shared";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { escopoVeiculoWhere, podeAcessarVeiculo } from "../services/escopoService.js";
import * as veiculos from "../services/veiculoService.js";
import * as ocupacao from "../services/ocupacaoService.js";
import * as rastreadores from "../services/rastreadorService.js";
import * as rastreamento from "../services/rastreamentoService.js";
import * as bi from "../services/biFrotaService.js";
import { prisma } from "../lib/prisma.js";

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
  // Como a operacao chama o carro ("C011"). Nulo e o normal.
  apelido: z.string().trim().max(40).nullish(),
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

// ---------------------------------------------------------------------------
// OCUPACAO — quem esta em qual viatura
// ---------------------------------------------------------------------------

/**
 * Colegas pro seletor do app.
 *
 * Rota NOVA em vez de afrouxar `GET /tecnicos`, que e `requireRole(ADMIN,
 * GESTOR)` com o comentario explicito de que "um usuario tecnico nunca precisa
 * da lista dos outros tecnicos". O seletor de acompanhantes contradiz aquilo
 * num caso especifico — entao abre-se um caso especifico, e nao a guarda toda.
 * Devolve so o minimo pra desenhar a linha.
 */
frotaRouter.get(
  "/colegas",
  requireRole(UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO),
  asyncHandler(async (req, res) => {
    const linhas = await prisma.usuario.findMany({
      where: { role: UserRole.TECNICO, ativo: true, id: { not: req.user!.sub } },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, nomeExibicao: true, temFoto: true, fotoVersao: true },
    });
    res.json(linhas);
  }),
);

/** Viaturas disponiveis + quem ja esta em cada uma — o app pergunta antes de decidir. */
frotaRouter.get(
  "/veiculos-para-jornada",
  requireRole(UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO),
  asyncHandler(async (req, res) => {
    const lista = await veiculos.listar(escopoVeiculoWhere(req.user!));
    const abertas = await ocupacao.ocupantesAbertos(lista.map((v) => v.id));
    res.json(
      lista.map((v) => ({
        ...v,
        ocupantes: abertas
          .filter((o) => o.veiculoId === v.id)
          .map((o) => ({ usuarioId: o.usuarioId, nome: o.usuarioNome, papel: o.papel })),
      })),
    );
  }),
);

/** A viatura em que EU estou — o app do tecnico ve so a dele, nunca a dos colegas. */
frotaRouter.get(
  "/minha-viatura",
  asyncHandler(async (req, res) => {
    res.json(await ocupacao.ocupacaoAtual(req.user!.sub));
  }),
);

frotaRouter.get(
  "/ocupacoes/abertas",
  requireRole(...rolesLeitura),
  asyncHandler(async (_req, res) => {
    res.json(await ocupacao.ocupantesAbertos());
  }),
);

frotaRouter.patch(
  "/ocupacoes/:id/encerrar",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    res.json(await ocupacao.encerrarPorAjuste(req.params.id));
  }),
);

const instanteSchema = z.object({ em: z.string().datetime().optional() });

/** "Quem estava na HFX3652 as 14:30?" */
frotaRouter.get(
  "/veiculos/:id/ocupantes",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { em } = instanteSchema.parse(req.query);
    res.json(await ocupacao.ocupantesEm(req.params.id, em ? new Date(em) : new Date()));
  }),
);

/** "Qual veiculo o Joao usava as 15:00?" */
frotaRouter.get(
  "/tecnicos/:usuarioId/veiculo",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    const { em } = instanteSchema.parse(req.query);
    res.json(await ocupacao.veiculoDe(req.params.usuarioId, em ? new Date(em) : new Date()));
  }),
);

/** "Qual veiculo fez a OS #12345?" — LISTA, porque podem ter sido dois. */
frotaRouter.get(
  "/ordens-servico/:osId/veiculos",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    res.json(await ocupacao.veiculosDaOs(req.params.osId));
  }),
);

// ---------------------------------------------------------------------------
// RASTREAMENTO
// ---------------------------------------------------------------------------

frotaRouter.get(
  "/mapa",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    const posicoes = await rastreamento.mapaAoVivo(escopoVeiculoWhere(req.user!));
    const abertas = await ocupacao.ocupantesAbertos(posicoes.map((p) => p.veiculoId));
    res.json({
      // `agoraServidor` acompanha: a IDADE da posicao e o que decide se o gestor
      // pode confiar no pino, e medi-la com o relogio do navegador daria numero
      // diferente em cada maquina. Mesmo padrao da jornada.
      agoraServidor: new Date().toISOString(),
      veiculos: posicoes.map((p) => ({
        ...p,
        ocupantes: abertas.filter((o) => o.veiculoId === p.veiculoId).map((o) => o.usuarioNome),
      })),
    });
  }),
);

const trilhaSchema = z.object({
  de: z.string().datetime().optional(),
  ate: z.string().datetime().optional(),
  precisao: z.enum(["alta", "media"]).optional(),
});

/** O PERCURSO do veiculo num intervalo. */
frotaRouter.get(
  "/veiculos/:id/trilha",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const q = trilhaSchema.parse(req.query);
    const { inicio, fim } = diaBrasileiro(new Date());
    res.json(
      await rastreamento.trilha(
        req.params.id,
        q.de ? new Date(q.de) : inicio,
        q.ate ? new Date(q.ate) : fim,
        q.precisao ?? "media",
      ),
    );
  }),
);

frotaRouter.get(
  "/rastreadores",
  requireRole(...rolesLeitura),
  asyncHandler(async (_req, res) => res.json(await rastreadores.listarRastreadores())),
);

/**
 * O que a conta do fornecedor tem e o ISPhub ainda nao.
 *
 * ADMIN, e nao GESTOR: importar cria VEICULO, que e cadastro-mestre. E leitura
 * pura — quem grava e o POST abaixo, com as placas confirmadas.
 */
frotaRouter.get(
  "/rastreadores/disponiveis",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const { provedorId } = z.object({ provedorId: z.string().uuid().nullish() }).parse(req.query);
    res.json(await rastreadores.listarDisponiveis(provedorId ?? null));
  }),
);

const importacaoSchema = z.object({
  provedorId: z.string().uuid().nullish(),
  itens: z
    .array(
      z.object({
        identificadorExterno: z.string().trim().min(1).max(60),
        /*
         * A placa vem do CORPO porque quem confirma e o gestor. O palpite do
         * apelido do aparelho serve pra PREENCHER o campo na tela, nunca pra
         * gravar sozinho: errar aqui nao produz um cadastro feio, produz um
         * rastreador vinculado ao carro de outra pessoa.
         */
        placa: z.string().trim().min(1).max(10),
        modelo: z.string().trim().max(80).nullish(),
      }),
    )
    .min(1)
    .max(50),
});

frotaRouter.post(
  "/rastreadores/importar",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const { itens, provedorId } = importacaoSchema.parse(req.body);
    res.status(201).json(await rastreadores.importarDoFornecedor(itens, provedorId ?? null, req.user!.sub));
  }),
);

const rastreadorSchema = z.object({
  identificadorExterno: z.string().trim().min(1).max(60),
  apelido: z.string().trim().max(60).nullish(),
  provedorId: z.string().uuid().nullish(),
});

frotaRouter.post(
  "/rastreadores",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    res.status(201).json(await rastreadores.criarRastreador(rastreadorSchema.parse(req.body)));
  }),
);

frotaRouter.post(
  "/rastreadores/:id/vincular",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    const { veiculoId } = z.object({ veiculoId: z.string().uuid() }).parse(req.body);
    res.json(await rastreadores.vincular(req.params.id, veiculoId, req.user!.sub));
  }),
);

frotaRouter.post(
  "/rastreadores/:id/desvincular",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    await rastreadores.desvincular(req.params.id);
    res.status(204).end();
  }),
);

frotaRouter.get(
  "/rastreadores/:id/vinculos",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => res.json(await rastreadores.historicoVinculos(req.params.id))),
);

// ---------------------------------------------------------------------------
// CREDENCIAL DO FORNECEDOR — ADMIN apenas
// ---------------------------------------------------------------------------

frotaRouter.get(
  "/config",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (_req, res) => res.json(await rastreadores.obterConfig(null))),
);

frotaRouter.put(
  "/config",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const dados = z
      .object({
        chave: z.string().trim().min(8),
        baseUrl: z.string().trim().url().optional(),
        intervaloPollingSegundos: z.number().int().min(30).max(3600).optional(),
        ativo: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(await rastreadores.salvarConfig({ ...dados, provedorId: null }));
  }),
);

frotaRouter.post(
  "/config/testar",
  requireRole(UserRole.ADMIN),
  asyncHandler(async (_req, res) => res.json(await rastreadores.testarConfig(null))),
);

/**
 * O DIA de um veiculo — sensores, viagens e eventos, num pedido so.
 *
 * Junta as tres fontes NO SERVIDOR, e nao em tres chamadas da tela, por tres
 * razoes que valem individualmente: o corte do dia tem de ser o mesmo
 * `diaBrasileiro` para todas; a serie de posicao e volume e nao pode trafegar
 * inteira; e o painel de sensores depende do DICIONARIO do fornecedor, que mora
 * na credencial cifrada e nunca sai daqui.
 */
frotaRouter.get(
  "/veiculos/:id/dia",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    await assertAcesso(req, req.params.id);
    const { de, ate } = z
      .object({ de: z.string().datetime().optional(), ate: z.string().datetime().optional() })
      .parse(req.query);
    const fim = ate ? new Date(ate) : new Date();
    const inicio = de ? new Date(de) : new Date(fim.getTime() - 24 * 60 * 60_000);
    res.json(await rastreamento.diaDoVeiculo(req.params.id, inicio, fim));
  }),
);

// ---------------------------------------------------------------------------
// BI DA FROTA
// ---------------------------------------------------------------------------

/**
 * Os tres endpoints do BI.
 *
 * Moram AQUI, e nao em `/financeiro`, por uma razao de desenho: o gestor precisa
 * de custo para decidir sobre a frota, mas `/financeiro/*` inteiro e ADMIN-only
 * e essa guarda protege o razao contabil, nao so o combustivel. A saida e a
 * distincao certa — o gestor ve a METRICA agregada ("R$ 1,82/km"), e continua
 * sem ver lancamento, cartao ou saldo.
 *
 * Tres magros e nao um gordo: cada bloco tem custo e modo de falha proprios, a
 * tela carrega os tres em paralelo e renderiza 2 de 3 se um cair. Um payload
 * unico tambem esconderia qual pedaco ficou caro quando o p95 subir.
 */
const periodoBiSchema = z
  .object({
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    provedorId: z.string().uuid().optional(),
  })
  .transform((v) => {
    /*
     * `-03:00` e nao `Z`. O usuario digita "12/05" pensando no dia dele; com
     * sufixo `Z` a janela abriria as 21h do dia 11 em Natal, e a serie por dia
     * (que agrupa pelo dia BRASILEIRO) rotulava a primeira coluna como 11/05
     * enquanto o filtro logo acima dizia 12/05. Offset fixo porque o Brasil
     * aboliu o horario de verao em 2019 — mesma constante de `dia.ts`.
     */
    const ate = v.ate ? new Date(`${v.ate}T23:59:59.999-03:00`) : new Date();
    const de = v.de
      ? new Date(`${v.de}T00:00:00.000-03:00`)
      : new Date(ate.getTime() - 89 * 24 * 60 * 60_000);
    return { de, ate, provedorId: v.provedorId };
  })
  .refine((v) => v.de <= v.ate, { message: "O início do período não pode ser depois do fim." });

frotaRouter.get(
  "/bi/custo",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    const { de, ate, provedorId } = periodoBiSchema.parse(req.query);
    res.json(await bi.custo(escopoVeiculoWhere(req.user!, provedorId), de, ate));
  }),
);

frotaRouter.get(
  "/bi/uso",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    const { de, ate, provedorId } = periodoBiSchema.parse(req.query);
    res.json(await bi.uso(escopoVeiculoWhere(req.user!, provedorId), de, ate));
  }),
);

frotaRouter.get(
  "/bi/auditoria",
  requireRole(...rolesLeitura),
  asyncHandler(async (req, res) => {
    const { de, ate, provedorId } = periodoBiSchema.parse(req.query);
    res.json(await bi.auditoria(escopoVeiculoWhere(req.user!, provedorId), de, ate));
  }),
);
