import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../lib/prisma.js";

/**
 * A chave que um sistema PARCEIRO do provedor usa pra entrar AQUI, pela API de
 * agendamento (`/api/parceiro/v1/agenda`). O AtendAI e um deles; qualquer
 * outro sistema do provedor entra pelo mesmo caminho.
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

/** O que a tela pode ver: nunca a chave, so o prefixo e o uso. */
export async function chaveDoProvedor(provedorId: string) {
  return prisma.chaveParceiro.findUnique({
    where: { provedorId },
    select: { prefixo: true, rotulo: true, usoEm: true, criadoEm: true },
  });
}

/**
 * Gera (ou REGERA) a chave de um provedor. Devolve em claro — a unica vez em
 * que ela existe fora do hash.
 *
 * Regerar invalida a anterior no mesmo instante: e isso que faz este botao
 * servir tanto pra criar quanto pra revogar uma chave vazada, sem precisar de
 * um segundo botao que ninguem lembraria de usar.
 */
export async function gerarChaveEntrada(provedorId: string, rotulo?: string | null): Promise<string> {
  const chave = `${PREFIXO}${randomBytes(24).toString("base64url")}`;
  const dados = { hash: hashChave(chave), prefixo: chave.slice(0, TAM_PREFIXO), usoEm: null };
  await prisma.chaveParceiro.upsert({
    where: { provedorId },
    create: { provedorId, rotulo: rotulo ?? null, ...dados },
    update: rotulo === undefined ? dados : { ...dados, rotulo },
  });
  return chave;
}

/** Tira a chave de circulacao. */
export async function revogarChaveEntrada(provedorId: string): Promise<void> {
  await prisma.chaveParceiro.deleteMany({ where: { provedorId } });
}

/**
 * Resolve a chave num provedor. `null` = nao autorizado, sem distinguir por
 * que: dizer "essa chave existe mas esta desativada" ja e informacao a mais
 * pra quem esta tentando adivinhar.
 */
export async function provedorDaChave(chave: string): Promise<string | null> {
  if (!chave.startsWith(PREFIXO)) return null;
  const linha = await prisma.chaveParceiro.findUnique({
    where: { prefixo: chave.slice(0, TAM_PREFIXO) },
    select: { id: true, provedorId: true, hash: true, provedor: { select: { ativo: true } } },
  });
  // Provedor desligado leva a chave junto: desativar o provedor tem que bastar.
  if (!linha?.provedor.ativo) return null;
  if (!iguais(hashChave(chave), linha.hash)) return null;

  // Best-effort e fora do caminho da resposta: saber que a integracao parou de
  // chamar vale um UPDATE, mas nao vale atrasar quem esta chamando.
  void prisma.chaveParceiro.update({ where: { id: linha.id }, data: { usoEm: new Date() } }).catch(() => {});

  return linha.provedorId;
}
