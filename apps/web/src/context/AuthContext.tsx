import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { UsuarioPublic } from "@isphub/shared";
import { api, ApiError, getAuthToken, setAuthToken } from "@/lib/apiClient";

interface AuthContextValue {
  usuario: UsuarioPublic | null;
  carregando: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioPublic | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    async function restaurarSessao() {
      if (!getAuthToken()) {
        setCarregando(false);
        return;
      }
      try {
        const me = await api.get<UsuarioPublic>("/auth/me");
        setUsuario(me);
      } catch {
        setAuthToken(null);
      } finally {
        setCarregando(false);
      }
    }
    void restaurarSessao();
  }, []);

  async function login(email: string, senha: string) {
    const resp = await api.post<{ token: string; usuario: UsuarioPublic }>("/auth/login", { email, senha });
    setAuthToken(resp.token);
    setUsuario(resp.usuario);
  }

  function logout() {
    setAuthToken(null);
    setUsuario(null);
  }

  return <AuthContext.Provider value={{ usuario, carregando, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}

export { ApiError };
