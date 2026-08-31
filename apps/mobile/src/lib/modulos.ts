import { isCore, type ModuloHabilitado, type ModuloId } from "@isphub/shared";

/**
 * "Esse modulo esta ligado pra este usuario?" — predicado PURO, separado do
 * hook porque e o que da pra testar sem renderizador.
 *
 * Mora aqui e nao em `config.tsx` por um motivo concreto: `config.tsx` importa
 * AsyncStorage e `./api`, que puxam `react-native`. O runner nao consegue nem
 * parsear a fonte Flow da RN, entao logica pura vizinha desses imports so
 * seria testavel mockando nativo. Mesma razao do `evidencias/limites.ts`.
 *
 * O core responde `true` mesmo com lista vazia: `primeiroNaoVazio` (config.tsx)
 * garante que o app nunca fica sem a fila, e o predicado nao pode furar essa
 * garantia.
 */
export function moduloHabilitado(modulos: ModuloHabilitado[], id: ModuloId): boolean {
  if (isCore(id)) return true;
  return modulos.some((m) => m.id === id);
}
