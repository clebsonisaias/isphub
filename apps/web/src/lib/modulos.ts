import { useQuery } from "@tanstack/react-query";
import type { AppConfig, ModuloId } from "@isphub/shared";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/context/AuthContext";

/**
 * Modulos habilitados pro usuario atual — mesma fonte que o mobile usa
 * (`GET /config`, ver apps/mobile/src/lib/config.tsx), so que sem a cadeia de
 * cache offline (o web sempre tem conexao pra carregar a propria SPA).
 */
export function useModulosHabilitados(): { ids: Set<ModuloId>; carregando: boolean } {
  const { usuario } = useAuth();
  const query = useQuery({
    queryKey: ["config"],
    enabled: !!usuario,
    queryFn: () => api.get<AppConfig>("/config"),
  });
  const ids = new Set((query.data?.modulos ?? []).map((m) => m.id));
  return { ids, carregando: query.isLoading };
}
