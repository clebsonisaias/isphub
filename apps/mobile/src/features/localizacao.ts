import * as Location from "expo-location";

/**
 * Posicao atual, SEM travar a acao que a pediu.
 *
 * Toda acao que carimba localizacao (iniciar jornada, marcar a caminho,
 * concluir OS) e uma acao de trabalho: ela tem de acontecer com ou sem GPS.
 * Permissao negada, sinal ruim dentro do predio, modo aviao — nada disso pode
 * deixar o tecnico travado na porta do cliente. Por isso devolve `null` em vez
 * de lancar.
 *
 * Estava dentro de `features/jornada/api.ts`; virou modulo proprio quando o
 * segundo consumidor apareceu, antes que existisse uma terceira copia.
 */
export async function obterGeoOuNada(): Promise<{ lat: number; lng: number } | null> {
  try {
    const permissao = await Location.requestForegroundPermissionsAsync();
    if (!permissao.granted) return null;
    const posicao = await Location.getCurrentPositionAsync({});
    return { lat: posicao.coords.latitude, lng: posicao.coords.longitude };
  } catch {
    return null;
  }
}
