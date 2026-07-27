/**
 * Copia texto pra área de transferência com fallback pra contexto NÃO-seguro.
 *
 * A produção do ISPhub roda em http (sslip.io), e `navigator.clipboard` só
 * existe em contexto seguro (HTTPS ou localhost) — em http ele é `undefined`.
 * Por isso tentamos a Clipboard API primeiro e caímos no truque clássico do
 * `<textarea>` + `execCommand("copy")`, que funciona em http. Retorna se
 * conseguiu, pro chamador dar (ou não) o feedback de "copiado".
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // cai pro fallback abaixo
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = texto;
    // Fora da tela e sem rolar a página ao focar.
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Só os dígitos, com DDI 55 (Brasil) na frente quando o número vem sem ele. */
export function numeroWhatsApp(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");
  if (!digitos) return "";
  // 10 (fixo) ou 11 (celular) dígitos = número BR sem DDI → prefixa 55.
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}
