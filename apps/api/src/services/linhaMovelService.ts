import type { BrazmovelConnector, LinhaCandidata, LinhaMovel, TesteConexao } from "@isphub/shared";
import { cpfValido, nomesConferem } from "@isphub/shared";
import { createBrazmovelConnector } from "../connectors/brazmovel.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { comConcorrenciaLimitada } from "../lib/limitador.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";

/**
 * A linha movel corporativa do tecnico (chip CITmax/Brazmovel).
 *
 * Duas operacoes, com publicos e riscos bem diferentes:
 *
 *  - **Vincular** (ADMIN): recebe um CPF, pergunta a operadora quais linhas ele
 *    tem, e guarda o `lineId`. E o unico ponto do sistema onde um CPF qualquer
 *    produz resposta — o token da Brazmovel vale para a base INTEIRA da CITmax.
 *    Por isso devolve o minimo, confere o nome e nunca revela o titular.
 *  - **Consultar a propria linha** (qualquer usuario logado): nao aceita
 *    parametro nenhum. O `lineId` vem do banco, pelo id do usuario do token.
 */

/** Concorrencia maxima contra a operadora. */
const MAX_CONCORRENTE = 4;

/**
 * Cache curto da consulta por usuario.
 *
 * `comConcorrenciaLimitada` limita CONCORRENCIA, nao TAXA: tres pull-to-refresh
 * seguidos na tela de Perfil passam os tres. Como cada consulta sao 3 chamadas a
 * operadora, um cache de 45s corta a rajada e ainda deixa a tela mais rapida.
 * O dado nao muda de segundo em segundo — franquia e plano mudam em horas.
 */
const TTL_CACHE_MS = 45_000;
const cache = new Map<string, { em: number; valor: LinhaMovel | null }>();

/** Invalida o cache de um usuario (usado ao vincular/desvincular). */
export function esquecerCache(usuarioId: string): void {
  cache.delete(usuarioId);
}

export function buildBrazmovelConnector(config: {
  baseUrl: string;
  tokenCifrado: string;
}): BrazmovelConnector {
  return createBrazmovelConnector({
    url: config.baseUrl,
    token: decrypt(config.tokenCifrado),
  });
}

/** A config da operacao, ou `null` se a integracao nunca foi configurada. */
export async function obterConfig() {
  return prisma.brazmovelConfig.findFirst();
}

/**
 * Executa uma leitura na operadora.
 *
 * Lanca `HttpError(412)` quando nao ha credencial — a rota traduz isso em
 * `configurada: false` com 200, para o app esconder o bloco em vez de mostrar
 * erro para um tecnico que nao tem nada a ver com a configuracao.
 */
export async function comBrazmovel<T>(fn: (b: BrazmovelConnector) => Promise<T>): Promise<T> {
  const config = await obterConfig();
  if (!config || !config.ativo) {
    throw new HttpError(412, "Telefonia móvel não configurada");
  }
  const braz = buildBrazmovelConnector(config);
  return comConcorrenciaLimitada("brazmovel", MAX_CONCORRENTE, () => fn(braz));
}

// ---------------------------------------------------------------------------
// CONFIG (credencial) — ADMIN
// ---------------------------------------------------------------------------

/** O que a tela pode ver. O token NUNCA sai, nem mascarado. */
export type ConfigPublica = {
  configurada: boolean;
  baseUrl: string;
  ativo: boolean;
  ultimoTesteEm: Date | null;
  ultimoTesteOk: boolean | null;
  ultimoTesteMensagem: string | null;
};

export async function configPublica(): Promise<ConfigPublica | null> {
  const c = await obterConfig();
  if (!c) return null;
  return {
    configurada: true,
    baseUrl: c.baseUrl,
    ativo: c.ativo,
    ultimoTesteEm: c.ultimoTesteEm,
    ultimoTesteOk: c.ultimoTesteOk,
    ultimoTesteMensagem: c.ultimoTesteMensagem,
  };
}

export async function salvarConfig(dados: {
  baseUrl?: string;
  token?: string;
  ativo?: boolean;
}): Promise<ConfigPublica> {
  const existente = await obterConfig();
  // A URL ja chega validada contra SSRF pelo `superRefine(validarUrlExterna)` do
  // schema da rota — mesma guarda de `erpConfig` e `canaisWhatsapp`.
  const baseUrl = dados.baseUrl?.trim() || existente?.baseUrl || "https://api.brazmovel.com.br/v1";

  if (!existente && !dados.token) {
    throw new HttpError(400, "Informe o token da Brazmóvel para configurar");
  }

  if (existente) {
    await prisma.brazmovelConfig.update({
      where: { id: existente.id },
      data: {
        baseUrl,
        ...(dados.token ? { tokenCifrado: encrypt(dados.token) } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
        // Trocar a credencial invalida o que o teste anterior provou.
        ...(dados.token ? { ultimoTesteEm: null, ultimoTesteOk: null, ultimoTesteMensagem: null } : {}),
      },
    });
  } else {
    await prisma.brazmovelConfig.create({
      data: { baseUrl, tokenCifrado: encrypt(dados.token!), ativo: dados.ativo ?? true },
    });
  }
  // A credencial mudou: tudo que estava em cache foi lido com a antiga.
  cache.clear();
  return (await configPublica())!;
}

export async function testarConexao(): Promise<TesteConexao> {
  const config = await obterConfig();
  if (!config) throw new HttpError(404, "Telefonia móvel não configurada");
  const resultado = await buildBrazmovelConnector(config).testarConexao();
  await prisma.brazmovelConfig.update({
    where: { id: config.id },
    data: {
      ultimoTesteEm: new Date(),
      ultimoTesteOk: resultado.ok,
      // O status HTTP entra na mensagem de proposito — ver o campo no schema.
      ultimoTesteMensagem: resultado.ok
        ? `HTTP ${resultado.httpStatus ?? "?"}`
        : `${resultado.detalhe ?? "falhou"} (HTTP ${resultado.httpStatus ?? "?"})`,
    },
  });
  return resultado;
}

// ---------------------------------------------------------------------------
// VINCULO — ADMIN
// ---------------------------------------------------------------------------

/**
 * Quais linhas este CPF tem? So para o admin escolher qual vincular.
 *
 * Nao devolve consumo, nem plano, nem o nome do titular: a tela precisa que o
 * admin RECONHECA a linha do funcionario, nao que ele consulte terceiros.
 */
export async function buscarCandidatas(
  usuarioId: string,
  cpf: string,
): Promise<{ linhas: LinhaCandidata[]; nomeConfere: boolean }> {
  if (!cpfValido(cpf)) throw new HttpError(400, "CPF inválido");
  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true, nome: true },
  });
  if (!usuario) throw new HttpError(404, "Usuário não encontrado");

  const { nomeTitular, linhas } = await comBrazmovel((b) => b.candidatasPorCpf(cpf));
  // Defesa contra o digito trocado: um CPF errado produziria uma tela que
  // funciona, com a linha de um estranho. O nome NAO volta na resposta — senao
  // esta tela viraria um consultor de "de quem e este CPF".
  return { linhas, nomeConfere: nomesConferem(usuario.nome, nomeTitular) };
}

export async function vincular(usuarioId: string, lineId: string): Promise<void> {
  const id = String(lineId ?? "").trim();
  if (!id) throw new HttpError(400, "Linha inválida");

  const jaUsada = await prisma.usuario.findFirst({
    where: { brazmovelLineId: id, NOT: { id: usuarioId } },
    select: { nome: true },
  });
  if (jaUsada) {
    // O UNIQUE do banco tambem barra, mas com uma mensagem que ninguem entende.
    throw new HttpError(409, `Esta linha já está vinculada a ${jaUsada.nome}`);
  }

  await prisma.usuario.update({ where: { id: usuarioId }, data: { brazmovelLineId: id } });
  esquecerCache(usuarioId);
}

/** Este usuario tem linha vinculada? `null` = o usuario nao existe. */
export async function temVinculo(usuarioId: string): Promise<boolean | null> {
  const u = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { brazmovelLineId: true },
  });
  // O `lineId` em si nao volta por rota nenhuma: e o identificador da linha na
  // operadora e nao serve para nada na tela.
  return u ? u.brazmovelLineId !== null : null;
}

export async function desvincular(usuarioId: string): Promise<void> {
  await prisma.usuario.update({ where: { id: usuarioId }, data: { brazmovelLineId: null } });
  esquecerCache(usuarioId);
}

// ---------------------------------------------------------------------------
// CONSULTA — o proprio usuario
// ---------------------------------------------------------------------------

export type MinhaLinha =
  | { estado: "sem_integracao" }
  | { estado: "sem_vinculo" }
  | { estado: "nao_encontrada" }
  | { estado: "ok"; linha: LinhaMovel };

/**
 * A linha do usuario `usuarioId`, e nunca a de outro.
 *
 * **O `lineId` vem do banco, pelo id do usuario do token** — a funcao nao aceita
 * linha por parametro, e a rota nao aceita query nenhuma. Nao existe requisicao
 * possivel em que um tecnico peca a linha do colega: nao e uma checagem de
 * autorizacao que alguem pode esquecer de fazer, e a ausencia do parametro.
 *
 * Os quatro estados sao distintos de proposito. "Nao ha integracao configurada",
 * "seu CPF ainda nao foi vinculado" e "a linha vinculada nao existe mais" tem
 * causas e solucoes diferentes, e virariam a mesma tela vazia se fossem um so.
 */
export async function minhaLinha(usuarioId: string): Promise<MinhaLinha> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { brazmovelLineId: true },
  });
  if (!usuario?.brazmovelLineId) {
    // Sem vinculo nem chegamos a perguntar se ha credencial: o tecnico nao pode
    // resolver nenhum dos dois, e "fale com o gestor" e a mesma acao.
    return (await obterConfig()) ? { estado: "sem_vinculo" } : { estado: "sem_integracao" };
  }

  const emCache = cache.get(usuarioId);
  if (emCache && Date.now() - emCache.em < TTL_CACHE_MS) {
    return emCache.valor ? { estado: "ok", linha: emCache.valor } : { estado: "nao_encontrada" };
  }

  try {
    const linha = await comBrazmovel((b) => b.consultarLinha(usuario.brazmovelLineId!));
    cache.set(usuarioId, { em: Date.now(), valor: linha });
    return linha ? { estado: "ok", linha } : { estado: "nao_encontrada" };
  } catch (err) {
    if (err instanceof HttpError && err.status === 412) return { estado: "sem_integracao" };
    throw err;
  }
}
