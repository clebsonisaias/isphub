import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useRouter } from "expo-router";
import * as Location from "expo-location";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { usePush } from "@/features/notificacoes/push-hook";
import { PAINEL_URL, caminhoNoPainelDoPush, ficaNoPainel, lerMensagemPainel, scriptDeSessao, usaTelasNativas } from "@/lib/destino";
import { colors } from "@/theme/tokens";

/**
 * O PAINEL DENTRO DO APP — vendedor, gestor, admin e atendente usam o painel web
 * (o mesmo de painel.isphub.net.br), ja logados. Tudo que muda no painel chega
 * aqui na hora, sem passar pela loja.
 *
 * A sessao do painel e PROPRIA (POST /auth/sessao-web): app e painel tem cada
 * um o seu refresh rotativo. Compartilhar o do app faria um derrubar o outro
 * (reuso de refresh e tratado como roubo e revoga tudo).
 */

type Sessao = { token: string; refreshToken: string; marca: string };

export default function Painel() {
  const { token, usuario, carregando, logout } = useAuth();
  const router = useRouter();
  const web = useRef<WebView>(null);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [podeVoltar, setPodeVoltar] = useState(false);
  const [destino, setDestino] = useState(PAINEL_URL + "/");

  // Notificacao tocada: abre a conversa/OS no proprio painel.
  usePush((dados) => {
    const caminho = caminhoNoPainelDoPush(dados);
    if (caminho) setDestino(PAINEL_URL + caminho + (caminho.includes("?") ? "&" : "?") + "t=" + Date.now());
  });

  // Uma sessao de painel por abertura (e por "tentar de novo").
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    setErro(null);
    apiFetch<{ token: string; refreshToken: string }>("/auth/sessao-web", { method: "POST", token })
      .then((s) => vivo && setSessao({ ...s, marca: `${Date.now()}-${Math.random().toString(36).slice(2)}` }))
      .catch(() => vivo && setErro("Não consegui abrir o painel. Confira a internet e tente de novo."));
    return () => {
      vivo = false;
    };
  }, [token, tentativa]);

  // Pre-cadastro e chat usam a localizacao: pede uma vez, sem travar a tela.
  useEffect(() => {
    void Location.requestForegroundPermissionsAsync().catch(() => undefined);
  }, []);

  // Voltar do Android: primeiro dentro do painel, depois sai do app.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (podeVoltar) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [podeVoltar]);

  const sair = useCallback(async () => {
    setSessao(null);
    await logout();
    router.replace("/login");
  }, [logout, router]);

  const aoMensagem = useCallback(
    (ev: WebViewMessageEvent) => {
      const m = lerMensagemPainel(ev.nativeEvent.data);
      if (!m) return;
      if (m.tipo === "saiu") void sair();
      else void Linking.openURL(m.url).catch(() => undefined);
    },
    [sair],
  );

  // Link que nao e do painel (mapa, telefone, site) abre fora do app.
  const aoNavegar = useCallback((req: WebViewNavigation) => {
    if (ficaNoPainel(req.url)) return true;
    void Linking.openURL(req.url).catch(() => undefined);
    return false;
  }, []);

  if (carregando) return <Carregando />;
  if (!token) return <Redirect href="/login" />;
  // Tecnico (ou papel ainda desconhecido) tem as telas nativas.
  if (usuario && usaTelasNativas(usuario.role)) return <Redirect href="/minhas-os" />;

  if (erro) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: colors.ground }}>
        <Text style={{ fontSize: 17, fontWeight: "600", color: colors.ink, textAlign: "center" }}>{erro}</Text>
        <Pressable
          onPress={() => setTentativa((n) => n + 1)}
          style={{ minHeight: 48, paddingHorizontal: 24, borderRadius: 12, backgroundColor: colors.brand, justifyContent: "center" }}
          accessibilityRole="button"
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Tentar de novo</Text>
        </Pressable>
        <Pressable onPress={() => void sair()} style={{ minHeight: 44, justifyContent: "center" }} accessibilityRole="button">
          <Text style={{ color: colors.muted, fontSize: 15 }}>Sair</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!sessao) return <Carregando />;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: colors.card }}>
      <WebView
        ref={web}
        source={{ uri: destino }}
        injectedJavaScriptBeforeContentLoaded={scriptDeSessao(sessao)}
        onMessage={aoMensagem}
        onShouldStartLoadWithRequest={aoNavegar}
        onNavigationStateChange={(n) => setPodeVoltar(n.canGoBack)}
        startInLoadingState
        renderLoading={() => <Carregando />}
        onError={() => setErro("O painel não abriu. Confira a internet e tente de novo.")}
        applicationNameForUserAgent="ISPhubApp/1"
        geolocationEnabled
        domStorageEnabled
        javaScriptEnabled
        allowsBackForwardNavigationGestures
        allowFileAccess
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        setSupportMultipleWindows={false}
        pullToRefreshEnabled
        style={{ flex: 1, backgroundColor: colors.ground }}
      />
    </SafeAreaView>
  );
}

function Carregando() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ground }}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}
