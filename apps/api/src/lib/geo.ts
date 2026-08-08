import { z } from "zod";

/**
 * Coordenada opcional que acompanha uma acao do tecnico.
 *
 * Existe num lugar so porque os LIMITES sao detalhe de correcao: latitude vai
 * de -90 a 90 e longitude de -180 a 180, e trocar os dois (erro classico, ja
 * que "lat,lng" e "x,y" tem ordens opostas) passa despercebido em Natal, onde
 * ambos sao negativos e de magnitude parecida. Duas copias divergiriam.
 *
 * **Sempre opcional.** Permissao de localizacao negada nao pode impedir o
 * tecnico de marcar que saiu, chegou ou concluiu — a posicao e complemento da
 * acao, nunca requisito dela.
 */
export const geoSchema = z.object({
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

export type Geo = z.infer<typeof geoSchema>;

/**
 * Normaliza pro formato do banco.
 *
 * Metade de coordenada nao existe: `lat` sem `lng` aponta pra lugar nenhum e no
 * mapa viraria um pino no meio do oceano. Ou vem o par, ou vem nada.
 */
export function parGeo(geo: Geo | undefined): { lat: number | null; lng: number | null } {
  const lat = geo?.lat;
  const lng = geo?.lng;
  if (lat == null || lng == null) return { lat: null, lng: null };
  return { lat, lng };
}
