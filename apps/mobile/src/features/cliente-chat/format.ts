import type { TemplateWhatsappDTO } from "@isphub/shared";

/** So os digitos — o servidor normaliza pro formato E.164, aqui e so pra validar e nao mandar mascara. */
export function somenteDigitos(telefone: string): string {
  return telefone.replace(/\D/g, "");
}

/** DDD + 8 ou 9 digitos; com o 55 na frente vai a 13. Fora dessa faixa o disparo falharia na Meta. */
export function telefoneValido(telefone: string): boolean {
  const digitos = somenteDigitos(telefone);
  return digitos.length >= 10 && digitos.length <= 13;
}

/**
 * Troca os `{{n}}` do modelo pelos valores digitados. O que ainda nao foi
 * preenchido continua aparecendo como `{{n}}` — o preview mostra o buraco em
 * vez de fingir que a frase esta pronta.
 */
export function renderizarTemplate(template: TemplateWhatsappDTO, vars: Record<string, string>): string {
  const trocar = (texto: string) => texto.replace(/\{\{(\d+)\}\}/g, (marcador, indice: string) => vars[indice]?.trim() || marcador);
  const header = template.header ? `${trocar(template.header)}\n\n` : "";
  return `${header}${trocar(template.corpo)}`;
}

/** Toda variavel do modelo precisa de valor — a Meta rejeita o disparo com parametro vazio. */
export function templateCompleto(template: TemplateWhatsappDTO, vars: Record<string, string>): boolean {
  return template.variaveis.every((indice) => !!vars[String(indice)]?.trim());
}

/** So os indices que o modelo pede, ja aparados — evita mandar lixo de um modelo escolhido antes. */
export function varsDoTemplate(template: TemplateWhatsappDTO, vars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(template.variaveis.map((indice) => [String(indice), vars[String(indice)]?.trim() ?? ""]));
}
