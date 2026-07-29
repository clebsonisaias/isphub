import { useEffect, useMemo, useState } from "react";
import type { AppConfig, ModuloId } from "@isphub/shared";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/context/AuthContext";

/**
 * Modulos habilitados pro usuario atual — mesma fonte que o mobile usa
 * (`GET /config`, ver apps/mobile/src/lib/config.tsx), so que sem a cadeia de
 * cache offline (o web sempre tem conexao pra carregar a propria SPA).
 *
 * Busca na mao (useState + useEffect) de proposito: o web inteiro fala com a
 * API por `api.*` e NAO tem QueryClientProvider montado. Este hook ja usou
 * `useQuery` do @tanstack/react-query — que so esta declarado no
 * apps/mobile/package.json e chegava ate aqui pelo hoist do npm workspaces. O
 * build passava (o import resolvia) e o app quebrava em runtime: como o
 * AppShell chama este hook, o "No QueryClient set" derrubava TODA pagina
 * autenticada e sobrava so a tela escura. Nao reintroduzir react-query aqui
 * sem antes declarar a dependencia em apps/web e montar o provider.
 */
export function useModulosHabilitados(): { ids: Set<ModuloId>; carregando: boolean } {
  const { usuario } = useAuth();
  const [modulos, setModulos] = useState<ModuloId[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!usuario) {
      setModulos([]);
      return;
    }

    let ativo = true;
    setCarregando(true);

    api
      .get<AppConfig>("/config")
      .then((config) => {
        if (ativo) setModulos(config.modulos.map((m) => m.id));
      })
      .catch(() => {
        // Falhar aqui esconde os itens de nav que dependem de modulo, mas nunca
        // pode derrubar a navegacao — mesmo criterio do polling do sino no AppShell.
        if (ativo) setModulos([]);
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [usuario]);

  const ids = useMemo(() => new Set(modulos), [modulos]);
  return { ids, carregando };
}
