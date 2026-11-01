import { cpfValido } from "@isphub/shared";

/**
 * Regras puras da tela de pre-cadastro: mascaras, validacao e o rascunho que
 * sobrevive a sinal ruim. Com teste.
 */

export const soDigitos = (s: string) => s.replace(/\D/g, "");

/** "529.982.247-25" ou "12.345.678/0001-90", conforme o tamanho. */
export function mascararDocumento(bruto: string): string {
  const d = soDigitos(bruto).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/** "(84) 99999-1234". */
export function mascararCelular(bruto: string): string {
  const d = soDigitos(bruto).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const meio = d.length === 11 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, meio)}${d.length > meio ? `-${d.slice(meio)}` : ""}`;
}

/** "10/02/1990" enquanto digita. */
export function mascararData(bruto: string): string {
  const d = soDigitos(bruto).slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/");
}

export function mascararCep(bruto: string): string {
  const d = soDigitos(bruto).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Erro do documento, ou null. CNPJ so confere o tamanho (o SGP valida o resto). */
export function erroDocumento(bruto: string): string | null {
  const d = soDigitos(bruto);
  if (d.length === 11) return cpfValido(d) ? null : "CPF inválido — confira os números.";
  if (d.length === 14) return null;
  return "Digite os 11 números do CPF ou os 14 do CNPJ.";
}

/** Nascimento DD/MM/AAAA: data real, no passado, maior de 18. */
export function erroNascimento(texto: string, hoje = new Date()): string | null {
  const m = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "Use dia/mês/ano, ex.: 10/02/1990.";
  const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCDate() !== dia || d.getUTCMonth() !== mes - 1 || ano < 1900) return "Essa data não existe.";
  const maioridade = new Date(Date.UTC(ano + 18, mes - 1, dia));
  if (maioridade.getTime() > hoje.getTime()) return "O titular precisa ter 18 anos ou mais.";
  return null;
}

export function erroCelular(bruto: string): string | null {
  const d = soDigitos(bruto);
  return d.length === 10 || d.length === 11 ? null : "Celular com DDD, ex.: (84) 99999-1234.";
}

/** O que a resposta de cobertura do AtendAI significa para a venda. */
export type LeituraCobertura = { pode: boolean; tom: "ok" | "atencao" | "nao"; titulo: string; detalhe: string };

export function lerCobertura(r: { status?: string; zona?: { nome?: string } | null; cidade?: string | null; zonaMaisProxima?: { nome: string; distanciaKm: number } | null }): LeituraCobertura {
  const onde = [r.zona?.nome, r.cidade].filter(Boolean).join(" · ");
  switch (r.status) {
    case "coberto":
      return { pode: true, tom: "ok", titulo: "Tem cobertura", detalhe: onde };
    case "provavel":
      return { pode: true, tom: "atencao", titulo: "Cobertura provável", detalhe: `${onde ? `${onde}. ` : ""}Perto da borda: o técnico confirma na instalação.` };
    case "expansao":
      return { pode: false, tom: "nao", titulo: "Área em expansão", detalhe: "Ainda não instalamos aqui. Registre o interesse com a equipe comercial." };
    case "pedir_local_exato":
      return { pode: false, tom: "atencao", titulo: "Preciso do ponto exato", detalhe: "Use o GPS no local do cliente ou ajuste o pino no mapa." };
    default:
      return {
        pode: false,
        tom: "nao",
        titulo: "Sem cobertura",
        detalhe: r.zonaMaisProxima ? `Área mais próxima: ${r.zonaMaisProxima.nome}, a ${r.zonaMaisProxima.distanciaKm.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km.` : "Não atendemos este endereço.",
      };
  }
}

// ---------------------------------------------------------------------------
// Rascunho
// ---------------------------------------------------------------------------

const CHAVE = "isphub.preCadastro.rascunho";

/** Le o rascunho salvo. Navegador sem storage (aba anonima, bloqueio) = sem rascunho. */
export function lerRascunho<T>(): T | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as T) : null;
  } catch {
    return null;
  }
}

export function salvarRascunho(valor: unknown): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(valor));
  } catch {
    // sem storage: segue sem rascunho
  }
}

export function apagarRascunho(): void {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // idem
  }
}
