import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UsuarioPublic } from "@isphub/shared";
import { apiFetch } from "./api";
import { tokenStore } from "./token-store";
import { autenticarBiometria, checarBiometria } from "./biometria";

const TOKEN_KEY = "isphub_token";
const BIOMETRIA_KEY = "isphub_biometria"; // "1" = desbloqueio biometrico ligado

interface AuthValue {
  token: string | null;
  usuario: UsuarioPublic | null;
  /** true enquanto restaura a sessao guardada (splash). */
  carregando: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-busca GET /auth/me e atualiza `usuario` em memoria — chamar apos editar
   * foto/status no perfil (fonte unica de verdade continua sendo o servidor). */
  refetchMe: () => Promise<void>;

  // ---- Biometria (Face ID / digital) ----
  /** Desbloqueio biometrico ligado por este usuario. */
  biometriaAtiva: boolean;
  /** Ha uma sessao guardada esperando desbloqueio biometrico (nao entrou ainda). */
  bloqueadoPorBiometria: boolean;
  /** Roda o Face ID/digital e, se ok, entra com a sessao guardada. Devolve o sucesso. */
  desbloquearComBiometria: () => Promise<boolean>;
  /** Liga o desbloqueio biometrico (confirma com uma leitura). Precisa de sessao ativa. */
  ativarBiometria: () => Promise<boolean>;
  desativarBiometria: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<UsuarioPublic | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [biometriaAtiva, setBiometriaAtiva] = useState(false);
  const [bloqueadoPorBiometria, setBloqueado] = useState(false);

  // Restaura o token guardado. Se o desbloqueio biometrico estiver ligado, NAO
  // entra automatico — marca `bloqueado` e deixa a tela de login pedir o Face
  // ID/digital (com a senha sempre disponivel como saida). Sem biometria, o
  // comportamento e o de sempre: revalida no /auth/me (que tambem checa `ativo`).
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const guardado = await tokenStore.get(TOKEN_KEY);
        const bioLigada = (await tokenStore.get(BIOMETRIA_KEY)) === "1";
        if (vivo) setBiometriaAtiva(bioLigada);
        if (!guardado) return;
        if (bioLigada) {
          if (vivo) setBloqueado(true); // espera o desbloqueio na tela de login
          return;
        }
        const me = await apiFetch<UsuarioPublic>("/auth/me", { token: guardado });
        if (vivo) {
          setToken(guardado);
          setUsuario(me);
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
      biometriaAtiva,
      bloqueadoPorBiometria,
      async login(email, senha) {
        const resp = await apiFetch<{ token: string; usuario: UsuarioPublic }>("/auth/login", {
          method: "POST",
          body: { email, senha },
        });
        await tokenStore.set(TOKEN_KEY, resp.token);
        setToken(resp.token);
        setUsuario(resp.usuario);
        setBloqueado(false);
      },
      async logout() {
        await tokenStore.del(TOKEN_KEY);
        await tokenStore.del(BIOMETRIA_KEY);
        setToken(null);
        setUsuario(null);
        setBiometriaAtiva(false);
        setBloqueado(false);
      },
      async refetchMe() {
        if (!token) return;
        const me = await apiFetch<UsuarioPublic>("/auth/me", { token });
        setUsuario(me);
      },
      async desbloquearComBiometria() {
        const ok = await autenticarBiometria("Entrar no ISPhub");
        if (!ok) return false;
        const guardado = await tokenStore.get(TOKEN_KEY);
        if (!guardado) {
          setBloqueado(false);
          return false;
        }
        try {
          const me = await apiFetch<UsuarioPublic>("/auth/me", { token: guardado });
          setToken(guardado);
          setUsuario(me);
          setBloqueado(false);
          return true;
        } catch {
          // sessao guardada invalidou (senha trocada, usuario desativado): limpa
          // tudo e cai pro login por senha — nunca deixa preso num loop biometrico.
          await tokenStore.del(TOKEN_KEY);
          await tokenStore.del(BIOMETRIA_KEY);
          setBloqueado(false);
          setBiometriaAtiva(false);
          return false;
        }
      },
      async ativarBiometria() {
        const info = await checarBiometria();
        if (!info.disponivel) return false;
        const ok = await autenticarBiometria("Confirme para ativar o desbloqueio");
        if (!ok) return false;
        await tokenStore.set(BIOMETRIA_KEY, "1");
        setBiometriaAtiva(true);
        return true;
      },
      async desativarBiometria() {
        await tokenStore.del(BIOMETRIA_KEY);
        setBiometriaAtiva(false);
      },
    }),
    [token, usuario, carregando, biometriaAtiva, bloqueadoPorBiometria],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
