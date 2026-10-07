import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UsuarioPublic } from "@isphub/shared";
import { ApiError, apiFetch } from "./api";
import { tokenStore } from "./token-store";
import {
  assinarMudanca,
  definirPersistencia,
  desfechoDoDesbloqueio,
  type DesfechoDesbloqueio,
  carregarSessaoGuardada,
  getAccessToken,
  getRefreshToken,
  renovarSessao,
  setSessao,
} from "./sessao";
import { autenticarBiometria, checarBiometria } from "./biometria";
import { efeitoDe, ehPreferencia, type PreferenciaAcesso } from "./preferencia-acesso";
import { desregistrarPushAtual, limparBadge } from "./push";

// O par (access, refresh) e a persistencia dele moram em `sessao.ts`. Aqui so
// resta a preferencia de biometria, que e do usuario e nao da sessao.
const BIOMETRIA_KEY = "isphub_biometria"; // legado: "1" = digital ligada (ver migracao no boot)
const PREFERENCIA_KEY = "isphub_preferencia";
const EMAIL_KEY = "isphub_email";
/*
 * O primeiro nome, guardado junto do e-mail. Existe pra tela de bloqueio poder
 * dizer "Entrar como Joao": enquanto a sessao esta trancada nao houve `/auth/me`
 * nenhum, entao `usuario` e null e nao ha de onde tirar isso. Num aparelho
 * compartilhado e o que evita entrar como o colega sem perceber.
 */
const NOME_KEY = "isphub_nome";

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
  /**
   * A sessao longa acabou (expirou/foi revogada) e o desbloqueio caiu pra
   * senha. A preferencia de biometria FICA ligada — o proximo login por senha
   * re-arma sozinho, sem o tecnico ter que achar o interruptor no Perfil.
   */
  sessaoExpirou: boolean;
  /**
   * Roda o Face ID/digital e, se ok, entra com a sessao longa guardada.
   *
   * Devolve o DESFECHO e nao um booleano porque a tela precisa dizer coisas
   * diferentes: cancelar nao e erro, sem rede pede "tente de novo", e sessao
   * morta pede a senha. Um booleano obrigaria a tela a adivinhar.
   */
  desbloquearComBiometria: () => Promise<DesfechoDesbloqueio | "cancelado">;
  /** Liga o desbloqueio biometrico (confirma com uma leitura). Precisa de sessao ativa. */
  ativarBiometria: () => Promise<boolean>;
  desativarBiometria: () => Promise<void>;

  // ---- O que fica salvo neste aparelho ----
  /** `null` = o tecnico ainda nao escolheu; e o gatilho da folha pos-login. */
  preferencia: PreferenciaAcesso | null;
  /** Aplica a escolha AGORA: gravando ou apagando sessao e e-mail conforme ela. */
  definirPreferencia: (p: PreferenciaAcesso) => Promise<void>;
  /** E-mail guardado pra pre-preencher o login (vazio quando nao se guarda). */
  emailLembrado: string | null;
  /** Primeiro nome de quem tem a sessao guardada, pra tela de bloqueio. */
  nomeLembrado: string | null;
  /** Apaga TUDO deste aparelho e volta ao login limpo ("trocar de usuario"). */
  esquecerAparelho: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

const primeiro = (u: UsuarioPublic) => ((u.nomeExibicao || u.nome) ?? "").trim().split(/\s+/)[0] ?? "";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<UsuarioPublic | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [biometriaAtiva, setBiometriaAtiva] = useState(false);
  const [bloqueadoPorBiometria, setBloqueado] = useState(false);
  const [sessaoExpirou, setSessaoExpirou] = useState(false);
  const [preferencia, setPreferencia] = useState<PreferenciaAcesso | null>(null);
  const [emailLembrado, setEmailLembrado] = useState<string | null>(null);
  const [nomeLembrado, setNomeLembrado] = useState<string | null>(null);

  // Restaura o token guardado. Se o desbloqueio biometrico estiver ligado, NAO
  // entra automatico — marca `bloqueado` e deixa a tela de login pedir o Face
  // ID/digital (com a senha sempre disponivel como saida). Sem biometria, o
  // comportamento e o de sempre: revalida no /auth/me (que tambem checa `ativo`).
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        /*
         * MIGRACAO: antes da escolha existir, a unica coisa gravada era
         * `isphub_biometria = "1"`. Quem ja usa a digital tem so essa chave —
         * ignora-la desligaria a biometria de todo mundo no primeiro update, o
         * mesmo estrago que a Task 2 acabou de consertar por outro caminho.
         */
        const salva = await tokenStore.get(PREFERENCIA_KEY);
        const legadoBio = (await tokenStore.get(BIOMETRIA_KEY)) === "1";
        const pref: PreferenciaAcesso | null = ehPreferencia(salva) ? salva : legadoBio ? "biometria" : null;
        const [emailSalvo, nomeSalvo] = await Promise.all([tokenStore.get(EMAIL_KEY), tokenStore.get(NOME_KEY)]);
        if (vivo) {
          setPreferencia(pref);
          setEmailLembrado(emailSalvo);
          setNomeLembrado(nomeSalvo);
        }

        const { access, refresh } = await carregarSessaoGuardada();
        const bioLigada = pref === null ? legadoBio : efeitoDe(pref).pedeBiometria;
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
        // Servidor respondeu negando (nao-401: desativado etc.). Falta de rede
        // e 401 (access vencido, o normal de manha) NAO entram aqui.
        let recusou = false;
        if (access) {
          me = await apiFetch<UsuarioPublic>("/auth/me", { token: access }).catch((e) => {
            recusou = e instanceof ApiError && e.status !== 401;
            return null;
          });
        }
        // `renovarSessao` ja apaga a sessao quando o servidor RECUSA o refresh;
        // em falha de rede devolve false e preserva os tokens.
        if (!me && !recusou && refresh && (await renovarSessao())) {
          me = await apiFetch<UsuarioPublic>("/auth/me", { token: getAccessToken() });
        }
        if (!me) throw new Error(recusou ? "sessao recusada" : "sem rede");
        if (vivo) {
          setToken(getAccessToken());
          setUsuario(me);
        }
      } catch (e) {
        // So descarta quando o servidor respondeu negando. Sem rede, os tokens
        // ficam guardados: o mesmo caminho da biometria ("sem-rede" nao mexe em nada).
        if (e instanceof ApiError || (e instanceof Error && e.message === "sessao recusada")) {
          setSessao(null, null);
        }
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
      sessaoExpirou,
      preferencia,
      emailLembrado,
      nomeLembrado,
      async login(email, senha) {
        const resp = await apiFetch<{ token: string; refreshToken: string; usuario: UsuarioPublic }>("/auth/login", {
          method: "POST",
          body: { email, senha },
        });
        // `refreshToken` ja vinha nesta resposta desde que a sessao longa
        // entrou na API; o app recebia e descartava, e por isso a sessao dele
        // morria em 8h.
        setSessao(resp.token, resp.refreshToken);
        // A escolha ja feita continua valendo nos logins seguintes, em silencio.
        if (preferencia && efeitoDe(preferencia).guardaEmail) {
          await tokenStore.set(EMAIL_KEY, email.trim());
          await tokenStore.set(NOME_KEY, primeiro(resp.usuario));
          setEmailLembrado(email.trim());
          setNomeLembrado(primeiro(resp.usuario));
        }
        setToken(resp.token);
        setUsuario(resp.usuario);
        setBloqueado(false);
        setSessaoExpirou(false);
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
        // Cancelou a leitura: nao mexe em nada, o botao e a senha continuam ali.
        if (!ok) return "cancelado";

        /*
         * O access token dura 8h e a digital costuma ser usada na manha
         * seguinte, entao ele quase sempre chega vencido aqui. Quem responde e
         * a sessao LONGA (30 dias parados): `apiFetch` toma o 401, renova e
         * repete sozinho. Antes esta funcao desistia no primeiro 401 — e como
         * ela ainda apagava a preferencia junto, a digital "parava de
         * funcionar" no exato dia seguinte ao dia em que foi ligada.
         */
        let servidorRespondeu = true;
        try {
          const me = await apiFetch<UsuarioPublic>("/auth/me", { token: getAccessToken() });
          setToken(getAccessToken());
          setUsuario(me);
          setBloqueado(false);
          setSessaoExpirou(false);
          return "entrou";
        } catch (e) {
          // `ApiError` = o servidor respondeu (e recusou). Erro cru = nao deu
          // nem pra perguntar. Sao situacoes opostas e o codigo antigo tratava
          // as duas igual.
          servidorRespondeu = e instanceof ApiError;
        }

        const desfecho = desfechoDoDesbloqueio(false, servidorRespondeu);
        if (desfecho === "pedir-senha") {
          // Sessao morreu de verdade. Limpa a sessao, PRESERVA a preferencia:
          // o proximo login por senha volta a armar a digital sozinho.
          setSessao(null, null);
          setBloqueado(false);
          setSessaoExpirou(true);
        }
        // sem-rede: nao apaga nada. A tela avisa e ele tenta de novo.
        return desfecho;
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
      async esquecerAparelho() {
        // Nao passa pelo /auth/logout: quem toca em "trocar de usuario" pode
        // estar com a sessao ja invalida, e exigir rede pra trocar de pessoa
        // deixaria o proximo tecnico preso na tela do anterior.
        setSessao(null, null);
        await Promise.all([tokenStore.del(EMAIL_KEY), tokenStore.del(NOME_KEY), tokenStore.del(BIOMETRIA_KEY), tokenStore.del(PREFERENCIA_KEY)]);
        setEmailLembrado(null);
        setNomeLembrado(null);
        setBiometriaAtiva(false);
        setBloqueado(false);
        setSessaoExpirou(false);
        setPreferencia(null);
      },
      async definirPreferencia(p) {
        const efeito = efeitoDe(p);
        await tokenStore.set(PREFERENCIA_KEY, p);
        setPreferencia(p);

        /*
         * A escolha e APLICADA aqui, nao so anotada. `definirPersistencia(false)`
         * apaga o par (access, refresh) que ja estava gravado e passa a manter a
         * sessao so em memoria — sem isso "nao salvar nada" seria um rotulo
         * sobre um aparelho que continua guardando tudo.
         */
        await definirPersistencia(efeito.guardaSessao);

        if (efeito.guardaEmail) {
          if (usuario) {
            await tokenStore.set(EMAIL_KEY, usuario.email);
            await tokenStore.set(NOME_KEY, primeiro(usuario));
            setEmailLembrado(usuario.email);
            setNomeLembrado(primeiro(usuario));
          }
        } else {
          await tokenStore.del(EMAIL_KEY);
          await tokenStore.del(NOME_KEY);
          setEmailLembrado(null);
          setNomeLembrado(null);
        }

        // A digital exige a sessao guardada: sem refresh no aparelho nao ha o
        // que destrancar. Por isso ela nao e um interruptor a parte.
        if (efeito.pedeBiometria) {
          await tokenStore.set(BIOMETRIA_KEY, "1");
          setBiometriaAtiva(true);
        } else {
          await tokenStore.del(BIOMETRIA_KEY);
          setBiometriaAtiva(false);
        }
      },
      async desativarBiometria() {
        await tokenStore.del(BIOMETRIA_KEY);
        setBiometriaAtiva(false);
      },
    }),
    [token, usuario, carregando, biometriaAtiva, bloqueadoPorBiometria, sessaoExpirou, preferencia, emailLembrado, nomeLembrado],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
