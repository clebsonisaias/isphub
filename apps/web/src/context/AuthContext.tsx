import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UsuarioPublic } from "@isphub/shared";
import {
  api,
  ApiError,
  getAuthToken,
  getRefreshToken,
  registrarPerdaDeSessao,
  setAuthToken,
  setRefreshToken,
} from "@/lib/apiClient";

interface AuthContextValue {
  usuario: UsuarioPublic | null;
  carregando: boolean;
  /** Devolve o usuario logado (o papel decide para onde a tela de login leva). */
  login: (email: string, senha: string) => Promise<UsuarioPublic>;
  logout: () => Promise<void>;
  /** Encerra esta e TODAS as outras sessoes do usuario. */
  sairDeTodos: () => Promise<void>;
  /** Re-busca GET /auth/me e atualiza `usuario` — chamar apos editar foto/status/perfil. */
  refetchMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioPublic | null>(null);
  const [carregando, setCarregando] = useState(true);

  /*
   * A sessao pode acabar no meio do uso (senha trocada em outro aparelho,
   * usuario desativado, refresh recusado). Ate agora nada reagia a isso: a
   * tela continuava montada e cada chamada estourava um 401 solto no
   * componente que a fez. O apiClient avisa aqui, e aqui e o unico lugar que
   * sabe traduzir "perdi a sessao" pra "volte ao login".
   */
  useEffect(() => {
    registrarPerdaDeSessao(() => setUsuario(null));
    return () => registrarPerdaDeSessao(null);
  }, []);

  useEffect(() => {
    async function restaurarSessao() {
      if (!getAuthToken() && !getRefreshToken()) {
        setCarregando(false);
        return;
      }
      try {
        const me = await api.get<UsuarioPublic>("/auth/me");
        setUsuario(me);
      } catch (err) {
        /*
         * So descarta a sessao quando o servidor DISSE que ela nao vale (401).
         * Antes, qualquer falha caia aqui e limpava o token — recarregar a
         * pagina durante uma queda da API, ou sem rede, deslogava quem estava
         * perfeitamente logado. O apiClient ja tentou renovar antes de chegar
         * neste catch.
         */
        if (err instanceof ApiError && err.status === 401) {
          setAuthToken(null);
          setRefreshToken(null);
        }
      } finally {
        setCarregando(false);
      }
    }
    void restaurarSessao();
  }, []);

  const login = useCallback(async (email: string, senha: string) => {
    const resp = await api.post<{ token: string; refreshToken: string; usuario: UsuarioPublic }>(
      "/auth/login",
      { email, senha },
    );
    setAuthToken(resp.token);
    setRefreshToken(resp.refreshToken);
    setUsuario(resp.usuario);
    return resp.usuario;
  }, []);

  const logout = useCallback(async () => {
    // Encerra a sessao NO SERVIDOR antes de esquecer o token: ate agora logout
    // era so descartar do lado do cliente, e o refresh continuava valendo.
    const refresh = getRefreshToken();
    setAuthToken(null);
    setRefreshToken(null);
    setUsuario(null);
    if (refresh) {
      // Best-effort: sair da conta nao pode falhar porque a rede caiu.
      await api.post("/auth/logout", { refreshToken: refresh }).catch(() => {});
    }
  }, []);

  /** "Sair de todos os dispositivos" — derruba tambem as outras sessoes. */
  const sairDeTodos = useCallback(async () => {
    await api.post("/auth/sair-de-todos");
    setAuthToken(null);
    setRefreshToken(null);
    setUsuario(null);
  }, []);

  const refetchMe = useCallback(async () => {
    if (!getAuthToken()) return;
    const me = await api.get<UsuarioPublic>("/auth/me");
    setUsuario(me);
  }, []);

  const value = useMemo(
    () => ({ usuario, carregando, login, logout, sairDeTodos, refetchMe }),
    [usuario, carregando, login, logout, sairDeTodos, refetchMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}

export { ApiError };
