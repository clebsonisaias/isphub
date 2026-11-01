import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { Redirect, useRouter } from "expo-router";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { checarBiometria, iconeBiometria, rotuloBiometria, type BiometriaInfo } from "@/lib/biometria";
import { useInstalarPwa } from "@/lib/instalar-pwa";
import { Button } from "@/components/ui";
import { colors, font, radius, shadow, space } from "@/theme/tokens";

/** Um campo com rótulo em caixa-alta, realce de foco na marca e ícone opcional à direita. */
function CampoLogin({
  label,
  icone,
  aoTocarIcone,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string; icone?: keyof typeof Feather.glyphMap; aoTocarIcone?: () => void }) {
  const [focado, setFocado] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.campoWrap, focado && styles.campoFocado]}>
        <TextInput
          placeholderTextColor={colors.muted}
          style={styles.campo}
          onFocus={() => setFocado(true)}
          onBlur={() => setFocado(false)}
          {...props}
        />
        {icone ? (
          <Pressable onPress={aoTocarIcone} hitSlop={10} style={styles.campoIcone} accessibilityRole="button">
            <Feather name={icone} size={19} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function Login() {
  const { token, login, bloqueadoPorBiometria, desbloquearComBiometria, sessaoExpirou, emailLembrado, nomeLembrado, esquecerAparelho } =
    useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // PWA: oferece instalar já na entrada — é aqui que o técnico chega pelo link.
  const { modo: modoInstalar, instalar } = useInstalarPwa();
  const [email, setEmail] = useState(emailLembrado ?? "");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [bio, setBio] = useState<BiometriaInfo>({ disponivel: false, tipo: "generico" });
  const senhaRef = useRef<TextInput>(null);
  const tentouBioRef = useRef(false);

  useEffect(() => {
    checarBiometria().then(setBio).catch(() => {});
  }, []);

  /*
   * E-mail conhecido: preenche e vai DIRETO pro campo de senha. Um toque e um
   * teclado a menos — no sol, de luva, com a mao suja, e a diferenca entre
   * entrar e xingar. So foca quando nao ha biometria esperando, senao roubaria
   * a tela do prompt do Face ID/digital.
   */
  useEffect(() => {
    if (!emailLembrado) return;
    setEmail((atual) => atual || emailLembrado);
    if (bloqueadoPorBiometria) return;
    const t = setTimeout(() => senhaRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [emailLembrado, bloqueadoPorBiometria]);

  // Auto-prompt do Face ID/digital quando ha sessao guardada esperando
  // desbloqueio (como os apps de banco). Roda uma vez; se o usuario cancelar,
  // ele ainda tem o botao e a senha. Pequeno atraso pra a tela assentar.
  /*
   * Traduz o desfecho em mensagem. Cancelar NAO e erro — o tecnico so mudou de
   * ideia e a senha esta logo abaixo; encher a tela de vermelho ali seria
   * repreender quem nao fez nada errado.
   */
  const tentarBiometria = useCallback(async () => {
    setErro(null);
    const desfecho = await desbloquearComBiometria();
    if (desfecho === "sem-rede") setErro("Sem conexão. Tente de novo em instantes.");
  }, [desbloquearComBiometria]);

  useEffect(() => {
    if (!bloqueadoPorBiometria || !bio.disponivel || tentouBioRef.current) return;
    tentouBioRef.current = true;
    const t = setTimeout(() => void tentarBiometria(), 400);
    return () => clearTimeout(t);
  }, [bloqueadoPorBiometria, bio.disponivel, tentarBiometria]);

  // null = ainda nao sei (evita piscar animacao antes de resolver o reduce-motion).
  const [reduzir, setReduzir] = useState<boolean | null>(null);

  // Valores de animacao (Animated nativo — sem depender de reanimated/worklets).
  const marca = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;
  const pulso1 = useRef(new Animated.Value(0)).current;
  const pulso2 = useRef(new Animated.Value(0)).current;
  const treme = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduzir)
      .catch(() => setReduzir(false));
  }, []);

  useEffect(() => {
    if (reduzir === null) return;
    if (reduzir) {
      marca.setValue(1);
      card.setValue(1);
      return;
    }
    // Entrada encadeada: a marca dá um "spring" e o card sobe logo atrás.
    Animated.sequence([
      Animated.spring(marca, { toValue: 1, useNativeDriver: true, friction: 6, tension: 80 }),
      Animated.timing(card, { toValue: 1, duration: 420, delay: 40, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // Anéis de sinal pulsando atrás da marca — radar/broadcast de conectividade.
    const loop = (v: Animated.Value, atraso: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(atraso),
          Animated.timing(v, { toValue: 1, duration: 2600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const l1 = loop(pulso1, 0);
    const l2 = loop(pulso2, 1300);
    l1.start();
    l2.start();
    return () => {
      l1.stop();
      l2.stop();
    };
  }, [reduzir, marca, card, pulso1, pulso2]);

  // Shake horizontal do card ao errar — feedback imediato, além do texto.
  useEffect(() => {
    if (!erro || reduzir) return;
    Animated.sequence(
      [-9, 9, -7, 7, 0].map((x) => Animated.timing(treme, { toValue: x, duration: 55, useNativeDriver: true })),
    ).start();
  }, [erro, reduzir, treme]);

  // A porta de entrada (/) decide pelo papel: tecnico no nativo, o resto no painel.
  if (token) return <Redirect href="/" />;

  async function entrar() {
    setErro(null);
    setEnviando(true);
    try {
      await login(email.trim(), senha);
      router.replace("/");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Falha ao conectar com o servidor");
    } finally {
      setEnviando(false);
    }
  }

  const marcaEscala = marca.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const cardY = card.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });
  const anelEstilo = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.33, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Atmosfera de fundo: dois brilhos índigo bem suaves nos cantos, estáticos. */}
      <View pointerEvents="none" style={[styles.glow, styles.glowTopo]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowBaixo]} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Marca + anéis de sinal */}
          <Animated.View style={{ opacity: marca, transform: [{ scale: marcaEscala }], alignItems: "center", gap: space.md }}>
            <View style={styles.marcaWrap}>
              <Animated.View style={[styles.anel, anelEstilo(pulso1)]} />
              <Animated.View style={[styles.anel, anelEstilo(pulso2)]} />
              <View style={styles.marcaTile}>
                <Feather name="wifi" size={32} color={colors.onBrand} />
              </View>
            </View>
            <View style={{ alignItems: "center", gap: 3 }}>
              <Text style={styles.wordmark}>
                <Text style={{ color: colors.brand }}>ISP</Text>hub
              </Text>
              <Text style={styles.sub}>Área do técnico</Text>
            </View>
          </Animated.View>

          {/* Card de acesso */}
          <Animated.View style={[styles.card, { opacity: card, transform: [{ translateY: cardY }, { translateX: treme }] }]}>
            {bloqueadoPorBiometria && bio.disponivel ? (
              <>
                {/*
                  De quem e a sessao trancada. Num aparelho compartilhado evita
                  entrar como o colega sem perceber; no proprio, e a confirmacao
                  de que o app sabe quem voce e.
                */}
                {nomeLembrado ? <Text style={styles.quem}>Entrar como {nomeLembrado}</Text> : null}
                <Pressable
                  onPress={() => void tentarBiometria()}
                  style={({ pressed }) => [styles.bioBtn, pressed && { opacity: 0.9 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Entrar com ${rotuloBiometria(bio.tipo)}`}
                >
                  <Feather name={iconeBiometria(bio.tipo)} size={20} color={colors.onBrand} />
                  <Text style={styles.bioBtnTxt}>Entrar com {rotuloBiometria(bio.tipo)}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setEmail("");
                    void esquecerAparelho();
                  }}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => [{ alignSelf: "center" }, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.trocar}>Trocar de usuário</Text>
                </Pressable>
                <View style={styles.divisor}>
                  <View style={styles.divisorLinha} />
                  <Text style={styles.divisorTxt}>ou entre com senha</Text>
                  <View style={styles.divisorLinha} />
                </View>
              </>
            ) : null}

            <CampoLogin
              label="E-mail"
              value={email}
              onChangeText={setEmail}
              placeholder="voce@provedor.com.br"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => senhaRef.current?.focus()}
            />
            <CampoLogin
              label="Senha"
              value={senha}
              onChangeText={setSenha}
              placeholder="••••••••"
              secureTextEntry={!mostrarSenha}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => !enviando && entrar()}
              icone={mostrarSenha ? "eye-off" : "eye"}
              aoTocarIcone={() => setMostrarSenha((v) => !v)}
            />

            {/*
              Aviso, nao erro: a sessao longa acabou (30 dias parada, senha
              trocada ou sessao revogada). A preferencia de biometria continua
              ligada, entao este login por senha ja re-arma a digital — por isso
              a frase promete isso em vez de so informar a falha.
            */}
            {sessaoExpirou ? (
              <View style={styles.avisoWrap} accessibilityLiveRegion="polite">
                <Feather name="clock" size={15} color={colors.slaAmber} />
                <Text style={styles.avisoTxt}>
                  Sua sessão expirou. Entre com a senha — a digital volta a funcionar depois.
                </Text>
              </View>
            ) : null}

            {erro ? (
              <View style={styles.erroWrap} accessibilityLiveRegion="polite">
                <Feather name="alert-circle" size={15} color={colors.slaRed} />
                <Text style={styles.erroTxt}>{erro}</Text>
              </View>
            ) : null}

            <View style={{ marginTop: space.xs }}>
              <Button label={enviando ? "Entrando…" : "Entrar"} onPress={entrar} loading={enviando} fullWidth />
            </View>
          </Animated.View>

          {modoInstalar === "botao" ? (
            <View style={styles.instalar}>
              <Button
                label="Instalar o app no celular"
                variant="secondary"
                icon={<Feather name="download" size={16} color={colors.brandInk} />}
                onPress={() => void instalar()}
                fullWidth
              />
            </View>
          ) : modoInstalar === "dica-ios" ? (
            <View style={[styles.instalar, styles.dicaIos]}>
              <Feather name="share" size={18} color={colors.brandInk} />
              <Text style={styles.dicaIosTxt}>
                Para instalar o app: toque em <Text style={styles.dicaIosForte}>Compartilhar</Text> e depois em{" "}
                <Text style={styles.dicaIosForte}>Adicionar à Tela de Início</Text>.
              </Text>
            </View>
          ) : null}

          <Text style={styles.rodape}>Acesso exclusivo da equipe técnica.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  glow: { position: "absolute", width: 340, height: 340, borderRadius: 999, backgroundColor: colors.brand, opacity: 0.08 },
  glowTopo: { top: -140, right: -110 },
  glowBaixo: { bottom: -160, left: -120, opacity: 0.06 },

  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.xxl, gap: space.xl },

  marcaWrap: { width: 76, height: 76, alignItems: "center", justifyContent: "center" },
  anel: { position: "absolute", width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: colors.brand },
  marcaTile: { width: 76, height: 76, borderRadius: radius.xl, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", ...shadow.brand },
  wordmark: { fontSize: 30, fontWeight: font.weight.black as "800", color: colors.ink, letterSpacing: -0.8 },
  sub: { fontSize: font.size.sm, color: colors.ink2, fontWeight: font.weight.medium as "600" },

  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.md,
    ...shadow.md,
  },
  label: { fontSize: font.size.xs, fontWeight: font.weight.bold as "700", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.5 },
  campoWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardAlt,
    borderWidth: 1.5,
    borderColor: colors.line2,
    borderRadius: radius.md,
  },
  campoFocado: { borderColor: colors.brand, backgroundColor: colors.card },
  campo: { flex: 1, paddingHorizontal: space.md, paddingVertical: 13, fontSize: font.size.base, color: colors.ink },
  campoIcone: { paddingHorizontal: space.md, paddingVertical: 10 },

  instalar: { width: "100%", maxWidth: 420 },
  dicaIos: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dicaIosTxt: { flex: 1, fontSize: font.size.sm, color: colors.ink2, lineHeight: 19 },
  dicaIosForte: { fontWeight: font.weight.bold as "700", color: colors.ink },

  quem: { fontSize: font.size.sm, color: colors.ink2, textAlign: "center", fontWeight: font.weight.medium as "600" },
  trocar: { fontSize: font.size.sm, color: colors.brandInk, fontWeight: font.weight.medium as "600" },
  avisoWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.xs,
    backgroundColor: colors.slaAmberBg,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  avisoTxt: { flex: 1, fontSize: font.size.sm, color: colors.slaAmber, fontWeight: font.weight.medium as "600" },
    erroWrap: { flexDirection: "row", alignItems: "center", gap: space.xs, backgroundColor: colors.slaRedBg, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  erroTxt: { flex: 1, fontSize: font.size.sm, color: colors.slaRed, fontWeight: font.weight.medium as "600" },

  bioBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 15,
    ...shadow.brand,
  },
  bioBtnTxt: { fontSize: 16, fontWeight: font.weight.bold as "700", color: colors.onBrand, letterSpacing: 0.2 },
  divisor: { flexDirection: "row", alignItems: "center", gap: space.sm },
  divisorLinha: { flex: 1, height: 1, backgroundColor: colors.line2 },
  divisorTxt: { fontSize: font.size.xs, color: colors.muted, fontWeight: font.weight.medium as "600" },

  rodape: { fontSize: font.size.xs, color: colors.muted },
});
