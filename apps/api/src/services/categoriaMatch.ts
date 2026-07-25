/**
 * Auto-mapeamento de um "motivo"/tipo de OS do SGP para uma categoria
 * canonica da ISPhub, por semelhanca de palavra-chave. Cada provedor nomeia
 * seus tipos diferente (ex.: "Instalacao" x "Novo cliente" x "Ativacao" sao a
 * mesma categoria em SGPs distintos) — este modulo resolve isso sem exigir
 * mapeamento manual a cada provedor novo.
 *
 * So e chamado quando o tipo ainda nao tem categoriaId (nunca sobrescreve uma
 * escolha manual do admin). Sem match => null ("Nao classificado"), que fica
 * visivel no admin pra resolucao manual.
 */

export interface CategoriaParaMatch {
  id: string;
  ordem: number;
  ativo: boolean;
  palavrasChave: string[];
}

/** Faixa Unicode dos diacriticos combinantes (acento, til, cedilha) apos normalize("NFD"). */
const DIACRITICOS = /[̀-ͯ]/g;

/**
 * Normaliza texto pra comparacao: minusculas, sem acento/diacritico, sem
 * emoji/simbolos (o SGP real manda motivos como "🚨 Retirada 🚨"), espacos
 * colapsados.
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // remove emoji/simbolos, mantem letras/numeros/espaco
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sugere o id da categoria cuja alguma palavra-chave aparece na descricao do
 * tipo, respeitando a ordem (primeira categoria — por `ordem` — que casar
 * vence). Ignora categorias inativas. Retorna null se nada casar.
 */
export function sugerirCategoriaId(descricao: string, categorias: CategoriaParaMatch[]): string | null {
  const alvo = normalizarTexto(descricao);
  if (!alvo) return null;

  const candidatas = [...categorias].filter((c) => c.ativo).sort((a, b) => a.ordem - b.ordem);
  for (const categoria of candidatas) {
    for (const palavra of categoria.palavrasChave) {
      const chave = normalizarTexto(palavra);
      if (chave && alvo.includes(chave)) return categoria.id;
    }
  }
  return null;
}
