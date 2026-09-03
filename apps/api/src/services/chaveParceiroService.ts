import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../lib/prisma.js";

/**
 * A chave que um sistema parceiro (o AtendAI do provedor) usa pra entrar AQUI.
 *
 * Sentido oposto ao de `atendaiService`: la o ISPhub e o cliente, aqui ele e o
 * servidor. A chave vive na MESMA linha (`AtendaiConfig`) porque descreve o
 * mesmo par — "este provedor e o AtendAI dele" —, e uma segunda tabela pra
 * metade da mesma relacao daria dois lugares pra desligar a integracao, que
 * mais cedo ou mais tarde discordariam.
 *
 * HASH, nao cifrada: esta chave nunca precisa ser lida de volta, so comparada.
 * Cifrar daria a capacidade de exibi-la — que e exatamente a capacidade que nao
 * se quer ter num segredo de entrada. Mostrada UMA vez, ao gerar.
 */

const PREFIXO = "isk_";
/** Quantos caracteres do inicio ficam em claro (inclui o prefixo). */
const TAM_PREFIXO = 12;

function hashChave(chave: string): string {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

/** Comparacao em tempo constante — hash de tamanho fixo, entao nunca lanca. */
function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * Gera (ou REGERA) a chave de entrada de um provedor. Devolve em claro — a
 * unica vez em que ela existe fora do hash.
 *
 * Regerar invalida a anterior no mesmo instante: e isso que faz este botao
 * servir tanto pra criar quanto pra revogar uma chave vazada, sem precisar de
 * um segundo botao que ninguem lembraria de usar.
 */
export async function gerarChaveEntrada(provedorId: string): Promise<string> {
  const chave = `${PREFIXO}${randomBytes(24).toString("base64url")}`;
  await prisma.atendaiConfig.update({
    where: { provedorId },
    data: {
      chaveEntradaHash: hashChave(chave),
      chaveEntradaPrefixo: chave.slice(0, TAM_PREFIXO),
      chaveEntradaUsoEm: null,
    },
  });
  return chave;
}

/** Tira a chave de circulacao sem desfazer o resto do cadastro. */
export async function revogarChaveEntrada(provedorId: string): Promise<void> {
  await prisma.atendaiConfig.updateMany({
    where: { provedorId },
    data: { chaveEntradaHash: null, chaveEntradaPrefixo: null, chaveEntradaUsoEm: null },
  });
}

/**
 * Resolve a chave num provedor. `null` = nao autorizado, sem distinguir por
 * que: dizer "essa chave existe mas esta desativada" ja e informacao a mais
 * pra quem esta tentando adivinhar.
 */
export async function provedorDaChave(chave: string): Promise<string | null> {
  if (!chave.startsWith(PREFIXO)) return null;
  const linha = await prisma.atendaiConfig.findUnique({
    where: { chaveEntradaPrefixo: chave.slice(0, TAM_PREFIXO) },
    select: { id: true, provedorId: true, ativo: true, chaveEntradaHash: true },
  });
  if (!linha?.ativo || !linha.chaveEntradaHash) return null;
  if (!iguais(hashChave(chave), linha.chaveEntradaHash)) return null;

  // Best-effort e fora do caminho da resposta: saber que a integracao parou de
  // chamar vale um UPDATE, mas nao vale atrasar quem esta chamando.
  void prisma.atendaiConfig
    .update({ where: { id: linha.id }, data: { chaveEntradaUsoEm: new Date() } })
    .catch(() => {});

  return linha.provedorId;
}
