import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UsuarioPublic } from "@isphub/shared";
import { apiFetch } from "./api";
import { tokenStore } from "./token-store";
import {
  assinarMudanca,
  carregarSessaoGuardada,
  getAccessToken,
  getRefreshToken,
  renovarSessao,
  setSessao,
} from "./sessao";
import { autenticarBiometria, checarBiometria } from "./biometria";
import { desregistrarPushAtual, limparBadge } from "./push";

// O par (access, refresh) e a persistencia dele moram em `sessao.ts`. Aqui so
// resta a preferencia de biometria, que e do usuario e nao da sessao.
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
        const { access, refresh } = await carregarSessaoGuardada();
        const bioLigada = (await tokenStore.get(BIOMETRIA_KEY)) === "1";
        if (vivo) setBiometriaAtiva(bioLigada);
        if (!access && !refresh) return;
        if (bioLigada) {
          if (vivo) setBloqueado(true); // espera o desbloqueio na tela de login
          return;
        }
        /*
         * O access token dura 8h, entao na PRIMEIRA abertura do dia ele quase
         * sempre esta vencido. Antes o app desistia aqui e jogava o tecnico no
         * login; agora tenta a sessao longa, que dura 30 dias parada.
         */
        let me: UsuarioPublic | null = null;
        if (access) {
          me = await apiFetch<UsuarioPublic>("/auth/me", { token: access }).catch(() => null);
        }
        if (!me && refresh && (await renovarSessao())) {
          me = await apiFetch<UsuarioPublic>("/auth/me", { token: getAccessToken() });
        }
        if (!me) throw new Error("sessao invalida");
        if (vivo) {
          setToken(getAccessToken());
          setUsuario(me);
        }
      } catch {
        // sessao invalida/expirada ou usuario desativado -> descarta
        setSessao(null, null);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  /*
   * O token do contexto tem que acompanhar as renovacoes. Sem isto, `apiFetch`
   * passaria a usar o token novo (ele le do `sessao.ts`) enquanto as telas
   * continuariam segurando o velho — e qualquer coisa que use `token` fora do
   * apiFetch, como o download de anexo e o SSE, falharia calada.
   */
  useEffect(() => assinarMudanca(setToken), []);

  const value = useMemo<AuthValue>(
    () => ({
      token,
      usuario,
      carregando,
      biometriaAtiva,
      bloqueadoPorBiometria,
      async login(email, senha) {
        const resp = await apiFetch<{ token: string; refreshToken: string; usuario: UsuarioPublic }>("/auth/login", {
          method: "POST",
          body: { email, senha },
        });
        // `refreshToken` ja vinha nesta resposta desde que a sessao longa
        // entrou na API; o app recebia e descartava, e por isso a sessao dele
        // morria em 8h.
        setSessao(resp.token, resp.refreshToken);
        setToken(resp.token);
        setUsuario(resp.usuario);
        setBloqueado(false);
      },
      async logout() {
        // ANTES de limpar a sessao: desregistrar exige o token de auth, e sem
        // isto o aparelho continuaria recebendo push das conversas de quem
        // acabou de sair — grave num celular compartilhado pela equipe.
        await desregistrarPushAtual(token);
        await limparBadge();
        /*
         * Encerrar a sessao no SERVIDOR, nao so descartar aqui: sem isto o
         * refresh continuaria valendo 30 dias depois de "sair" — grave num
         * aparelho que a equipe compartilha. Falha nao pode travar a saida:
         * quem clicou em sair tem que sair, com ou sem rede.
         */
        const refresh = getRefreshToken();
        if (refresh) {
          await apiFetch("/auth/logout", { method: "POST", body: { refreshToken: refresh } }).catch(() => {});
        }
        setSessao(null, null);
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
        const guardado = getAccessToken();
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
          //
          // TODO(Task 2 do plano de sessao longa): tentar `renovarSessao()` antes
          // de desistir, e NAO apagar a preferencia de biometria — hoje uma falha
          // de rede desliga a digital do tecnico em silencio.
          setSessao(null, null);
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
