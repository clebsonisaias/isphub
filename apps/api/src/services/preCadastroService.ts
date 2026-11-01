import { mapSgpOsStatus, OsStatus, type RawOs } from "@isphub/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/errorHandler.js";
import { AtendaiIndisponivel, chamar, credencialDoProvedor } from "./atendaiService.js";
import { buildConnector } from "./erpConnectorService.js";

/**
 * PRE-CADASTRO EM CAMPO — o vendedor cadastra o cliente no local e agenda a
 * instalacao na hora.
 *
 * O cadastro, a cobertura, os planos e os vencimentos sao do AtendAI (rotas
 * `/isphub/*` da API externa dele): la ja moram o mapa de cobertura, os planos
 * por zona e a regra do `cadastrar_cliente`. O ISPhub so guarda o rastro
 * (`PreCadastro`), acha a OS de instalacao que o SGP abriu e agenda.
 */

// ---------------------------------------------------------------------------
// Parte pura
// ---------------------------------------------------------------------------

/**
 * A OS de instalacao na lista do contrato: aberta, de tipo instalacao, a mais
 * nova. Contrato novo costuma ter uma so, mas o SGP pode abrir outra (ex.:
 * "venda") junto — a de instalacao e a que vai pra agenda. Sem nenhuma com
 * "instal" no tipo, uma unica aberta serve; duas ou mais e ambiguo.
 */
export function escolherOsInstalacao(itens: RawOs[]): RawOs | null {
  const abertas = itens.filter((o) => {
    const s = mapSgpOsStatus(o.statusCode);
    return s === OsStatus.ABERTA || s === OsStatus.PENDENTE;
  });
  const maisNova = (a: RawOs, b: RawOs) => Number(b.sgpOsId) - Number(a.sgpOsId);
  const instalacao = abertas.filter((o) => /instala/i.test(o.tipoDescricao ?? "")).sort(maisNova);
  if (instalacao.length) return instalacao[0]!;
  return abertas.length === 1 ? abertas[0]! : null;
}

export interface FormularioPreCadastro {
  nome: string;
  cpfCnpj: string;
  nascimento?: string | null;
  celular?: string | null;
  email?: string | null;
  plano: { id: number; nome: string };
  vencimentoDia: number;
  logradouro: string;
  numero?: string | null;
  complemento?: string | null;
  referencia?: string | null;
  bairro: string;
  cidade: string;
  uf?: string | null;
  cep?: string | null;
  popId?: number | null;
  portadorId?: number | null;
  nasId?: number | null;
}

const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** O corpo do `POST /isphub/pre-cadastro` do AtendAI (nomes da tool `cadastrar_cliente`). */
export function corpoParaAtendai(f: FormularioPreCadastro): Record<string, unknown> {
  // O SGP so tem "complemento": o ponto de referencia vai junto, que e onde o tecnico le.
  const complemento = [f.complemento?.trim(), f.referencia?.trim() ? `Ref.: ${f.referencia.trim()}` : null]
    .filter(Boolean)
    .join(" · ");
  const corpo: Record<string, unknown> = {
    nome: f.nome.trim(),
    cpf_cnpj: soDigitos(f.cpfCnpj),
    plano_id: f.plano.id,
    vencimento_dia: f.vencimentoDia,
    logradouro: f.logradouro.trim(),
    bairro: f.bairro.trim(),
    cidade: f.cidade.trim(),
    numero: f.numero?.trim() || "S/N",
  };
  if (complemento) corpo["complemento"] = complemento;
  if (f.nascimento?.trim()) corpo["nascimento"] = f.nascimento.trim();
  if (soDigitos(f.celular)) corpo["celular"] = soDigitos(f.celular);
  if (f.email?.trim()) corpo["email"] = f.email.trim();
  if (f.uf?.trim()) corpo["uf"] = f.uf.trim().toUpperCase();
  if (soDigitos(f.cep).length === 8) corpo["cep"] = soDigitos(f.cep);
  if (f.popId) corpo["pop_id"] = f.popId;
  if (f.portadorId) corpo["portador_id"] = f.portadorId;
  if (f.nasId) corpo["nas_id"] = f.nasId;
  return corpo;
}

// ---------------------------------------------------------------------------
// AtendAI
// ---------------------------------------------------------------------------

async function credencial(provedorId: string) {
  const cred = await credencialDoProvedor(provedorId);
  if (!cred) throw new HttpError(409, "Este provedor não está ligado ao AtendAI — o pré-cadastro depende dele.");
  return cred;
}

/** Recusa de regra (422) chega ao vendedor com o texto do AtendAI; o resto e indisponibilidade. */
async function noAtendai<T>(provedorId: string, metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<T> {
  const cred = await credencial(provedorId);
  try {
    return await chamar<T>(cred, metodo, caminho, corpo);
  } catch (e) {
    if (e instanceof AtendaiIndisponivel && e.status === 422) throw new HttpError(422, e.message);
    if (e instanceof AtendaiIndisponivel && e.status === 400) throw new HttpError(400, `Dados recusados: ${e.message}`);
    throw new HttpError(502, "O AtendAI não respondeu. Confira o sinal e tente de novo.");
  }
}

export function cobertura(provedorId: string, q: { lat?: number; lng?: number; cep?: string; endereco?: string }) {
  const p = new URLSearchParams();
  if (q.lat != null && q.lng != null) {
    p.set("lat", String(q.lat));
    p.set("lng", String(q.lng));
  } else if (q.cep) p.set("cep", soDigitos(q.cep));
  else if (q.endereco) p.set("endereco", q.endereco);
  return noAtendai<Record<string, unknown>>(provedorId, "GET", `/isphub/cobertura?${p}`);
}

export async function vencimentos(provedorId: string): Promise<number[]> {
  const r = await noAtendai<{ itens: { dia?: number | string }[] }>(provedorId, "GET", "/isphub/vencimentos");
  const dias = r.itens.map((v) => Number(v.dia)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
  return [...new Set(dias)].sort((a, b) => a - b);
}

/** Envia ao AtendAI (que cadastra no SGP) e grava o rastro. */
export async function enviar(args: { provedorId: string; vendedorId: string; form: FormularioPreCadastro }) {
  const r = await noAtendai<{ protocolo?: string | null; contratoId?: string | null }>(
    args.provedorId,
    "POST",
    "/isphub/pre-cadastro",
    corpoParaAtendai(args.form),
  );
  return prisma.preCadastro.create({
    data: {
      provedorId: args.provedorId,
      vendedorId: args.vendedorId,
      clienteNome: args.form.nome.trim(),
      celular: soDigitos(args.form.celular) || null,
      cidade: args.form.cidade.trim(),
      bairro: args.form.bairro.trim(),
      plano: args.form.plano.nome,
      vencimentoDia: args.form.vencimentoDia,
      contratoId: r.contratoId ?? null,
      protocolo: r.protocolo ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// SGP do provedor
// ---------------------------------------------------------------------------

/**
 * Uma consulta: a OS de instalacao do contrato ja apareceu? Quem repete e a
 * tela (o SGP cria a OS na mesma chamada do cadastro, mas pode demorar a listar).
 */
export async function procurarOs(pc: { id: string; provedorId: string; contratoId: string | null; sgpOsId: string | null; regiao: string | null }) {
  if (pc.sgpOsId) return { sgpOsId: pc.sgpOsId, regiao: pc.regiao };
  if (!pc.contratoId) return null;
  const erp = await prisma.erpConfig.findFirst({ where: { provedorId: pc.provedorId, tipo: "SGP", ativo: true } });
  if (!erp) throw new HttpError(409, "Este provedor não tem SGP ligado ao ISPhub.");
  let lista: RawOs[];
  try {
    lista = (await buildConnector(erp).listServiceOrders({ contrato: Number(pc.contratoId), limit: 20, offset: 0 })).itens;
  } catch {
    throw new HttpError(502, "O SGP não respondeu agora. Tentando de novo...");
  }
  const os = escolherOsInstalacao(lista);
  if (!os) return null;
  const regiao = os.pop ?? os.endereco?.bairro ?? null;
  await prisma.preCadastro.update({ where: { id: pc.id }, data: { sgpOsId: os.sgpOsId, regiao, status: "os_encontrada" } });
  return { sgpOsId: os.sgpOsId, regiao };
}
