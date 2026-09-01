/**
 * URL da API, em modulo proprio de proposito: `lib/api.ts` importa
 * `lib/sessao.ts` (pra renovar no 401) e `lib/sessao.ts` precisa da base pra
 * chamar `/auth/refresh`. Deixar a constante em `api.ts` fecharia um ciclo
 * entre os dois — que funciona no ESM por sorte de ordem de avaliacao e quebra
 * de forma misteriosa quando a ordem muda. Tres linhas resolvem sem sorte.
 *
 * Vem de EXPO_PUBLIC_API_URL, embutida no bundle quando o Metro INICIA (nao no
 * reload); fallback pra API local no dev.
 */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
