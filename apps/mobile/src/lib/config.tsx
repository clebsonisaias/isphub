import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { MODULOS_CORE, MODULO_CATALOGO, type AppConfig, type ModuloHabilitado } from "@isphub/shared";
import { apiFetch } from "./api";
import { useAuth } from "./auth";

const CACHE_KEY = "isphub_config";

/**
 * Fallback duro do CORE: se `/config` falhar e nao houver cache (primeiro boot
 * offline), o app ainda abre com o(s) modulo(s) essencial(is). Nunca fica sem a fila.
 */
const CORE_FALLBACK: ModuloHabilitado[] = MODULOS_CORE.map((id) => {
  const m = MODULO_CATALOGO[id];
  return { id, nome: m.nome, icone: m.icone, core: m.core, ordem: m.ordemPadrao };
});

/**
 * Config efetiva do app. Cadeia de frescura/resiliencia:
 *   live (`/config`) -> cache (AsyncStorage, offline) -> CORE_FALLBACK.
 * O app monta a navegacao a partir dos `modulos` devolvidos.
 */
export function useModulos(): { modulos: ModuloHabilitado[]; carregando: boolean; offline: boolean } {
  const { token } = useAuth();
  const [cache, setCache] = useState<AppConfig | null>(null);
  const [cacheLido, setCacheLido] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => setCache(raw ? (JSON.parse(raw) as AppConfig) : null))
      .catch(() => setCache(null))
      .finally(() => setCacheLido(true));
  }, []);

  const query = useQuery({
    queryKey: ["config"],
    enabled: !!token,
    queryFn: async () => {
      const cfg = await apiFetch<AppConfig>("/config", { token });
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cfg)).catch(() => {});
      return cfg;
    },
  });

  const modulos = query.data?.modulos ?? cache?.modulos ?? CORE_FALLBACK;
  const offline = !query.data && (query.isError || !token);
  return { modulos, carregando: (query.isLoading && !cache) || !cacheLido, offline };
}
