import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UsuarioPublic } from "@isphub/shared";
import { apiFetch } from "./api";
import { tokenStore } from "./token-store";

const TOKEN_KEY = "isphub_token";

interface AuthValue {
  token: string | null;
  usuario: UsuarioPublic | null;
  /** true enquanto restaura a sessao guardada (splash). */
  carregando: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<UsuarioPublic | null>(null);
  const [carregando, setCarregando] = useState(true);

  // Restaura o token guardado e revalida no /auth/me (que tambem checa `ativo`).
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const guardado = await tokenStore.get(TOKEN_KEY);
        if (guardado) {
          const me = await apiFetch<UsuarioPublic>("/auth/me", { token: guardado });
          if (vivo) {
            setToken(guardado);
            setUsuario(me);
          }
        }
      } catch {
        // token invalido/expirado ou usuario desativado -> descarta
        await tokenStore.del(TOKEN_KEY);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      token,
      usuario,
      carregando,
      async login(email, senha) {
        const resp = await apiFetch<{ token: string; usuario: UsuarioPublic }>("/auth/login", {
          method: "POST",
          body: { email, senha },
        });
        await tokenStore.set(TOKEN_KEY, resp.token);
        setToken(resp.token);
        setUsuario(resp.usuario);
      },
      async logout() {
        await tokenStore.del(TOKEN_KEY);
        setToken(null);
        setUsuario(null);
      },
    }),
    [token, usuario, carregando],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
