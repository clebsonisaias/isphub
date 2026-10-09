import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  type StyleProp,
  type TextProps,
  type TextInputProps,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, font, radius, shadow, space } from "@/theme/tokens";

export function Screen({ children, style, ...rest }: ViewProps) {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={[styles.screenInner, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children, style, ...rest }: TextProps) {
  return (
    <Text style={[styles.muted, style]} {...rest}>
      {children}
    </Text>
  );
}

/** Rotulo de secao — caixa-alta, curto, acima de grupos de campos/listas. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

// LayoutAnimation no Android ainda precisa de opt-in explicito; sem isto a
// Dobravel abre num salto seco so nesse sistema.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Secao que abre e fecha com um toque.
 *
 * Existe pra resolver um conflito real da tela de detalhe da OS: a ficha do SGP
 * (plano, PPPoE, sinal, cadastro) e volumosa e so importa em UM momento — na
 * porta do cliente, com a ONU na mao. Deixada aberta, empurrava o motivo da
 * visita e os botoes de contato uns 900px pra baixo.
 *
 * Dobrar, e nao esconder atras de aba: o cabecalho fica SEMPRE visivel dizendo
 * o que ha dentro, com um resumo do que importa (ex.: "RX -21.5 dBm"). O
 * tecnico ve que existe sem precisar procurar, e paga um toque so quando
 * precisa. Aba, alem de esconder ate o rotulo do conteudo, brigaria com a barra
 * de abas que o app ja tem no rodape.
 */
export function Dobravel({
  titulo,
  resumo,
  inicialAberta = false,
  children,
}: {
  titulo: string;
  /** Uma linha do que ha dentro — evita abrir so pra descobrir. */
  resumo?: ReactNode;
  inicialAberta?: boolean;
  children: ReactNode;
}) {
  const [aberta, setAberta] = useState(inicialAberta);

  return (
    <View style={styles.dobravel}>
      <Pressable
        onPress={() => {
          // `easeInEaseOut` curto: a altura muda, entao o movimento AVISA que o
          // conteudo cresceu ali. Sem isso o resto da tela salta sem explicacao.
          LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
          setAberta((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: aberta }}
        accessibilityLabel={titulo}
        style={({ pressed }) => [styles.dobravelCabeca, pressed && { backgroundColor: colors.cardAlt }]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.sectionLabel}>{titulo}</Text>
          {resumo ? <View style={styles.dobravelResumo}>{resumo}</View> : null}
        </View>
        <Text style={styles.dobravelSeta}>{aberta ? "▲" : "▼"}</Text>
      </Pressable>
      {aberta ? <View style={styles.dobravelCorpo}>{children}</View> : null}
    </View>
  );
}

export function Card({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

export function Field({ style, ...props }: TextInputProps) {
  // `style` do chamador SOMA ao do campo. Antes vinha no spread depois e
  // substituia: a anotacao da OS (que so pede minHeight) perdia borda e fundo
  // e virava texto solto no meio da tela.
  return <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.field, style]} />;
}

// ---- Pill (badge de status/dado, tinta suave) ----

export type PillTone = "neutral" | "brand" | "blue" | "pink" | "teal" | "green" | "amber" | "red";

const PILL: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.line2, fg: colors.ink2 },
  brand: { bg: colors.brandBg, fg: colors.brandInk },
  blue: { bg: colors.blueBg, fg: colors.blue },
  pink: { bg: colors.pinkBg, fg: colors.pink },
  teal: { bg: colors.tealBg, fg: colors.teal },
  green: { bg: colors.slaGreenBg, fg: colors.slaGreen },
  amber: { bg: colors.slaAmberBg, fg: colors.slaAmber },
  red: { bg: colors.slaRedBg, fg: colors.slaRed },
};

export function Pill({ label, tone = "neutral", style }: { label: string; tone?: PillTone; style?: StyleProp<ViewStyle> }) {
  const c = PILL[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }, style]}>
      <Text style={[styles.pillTxt, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

// ---- Chip (opcao selecionavel, ex.: provedor, template) ----

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.8 }]}
    >
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

// ---- Segmented (troca entre 2+ opcoes — pilula deslizante) ----

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segTrack}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segItem, active && styles.segItemActive, active && shadow.sm]}
          >
            <Text style={[styles.segLabel, active && styles.segLabelActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- Hero (bloco de saudacao/identidade, indigo) ----

/**
 * Bloco indigo do topo — a "pegada" da referencia. Titulo + subtitulo a
 * esquerda, um slot livre a direita (avatar, botao). Textura sutil de arcos de
 * "sinal" no canto. O padding inferior extra pode ser passado via `style` pra
 * uma faixa de conteudo (ex.: contadores) subir por cima.
 */
export function Hero({
  title,
  subtitle,
  right,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.hero, style]}>
      <View pointerEvents="none" style={styles.heroRings}>
        <View style={[styles.heroRing, styles.heroRingA]} />
        <View style={[styles.heroRing, styles.heroRingB]} />
      </View>
      <View style={styles.heroRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>{title}</Text>
          {subtitle ? <Text style={styles.heroSub}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

// ---- IconButton (acao circular de header) ----

export function IconButton({
  children,
  onPress,
  tone = "brand",
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  /** brand = circulo indigo suave (sobre fundo claro); onBrand = translucido (dentro do Hero). */
  tone?: "brand" | "onBrand";
  /** Obrigatorio na pratica: so ha um icone aqui, entao sem isto o leitor de
   * tela anuncia um botao sem nome nenhum. */
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconBtn, tone === "onBrand" ? styles.iconBtnOnBrand : styles.iconBtnBrand, pressed && { opacity: 0.8 }]}
    >
      {children}
    </Pressable>
  );
}

// ---- Button ----

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
type BtnSize = "md" | "sm";

const BTN: Record<BtnVariant, { bg: string; fg: string; border?: string; elevate?: boolean }> = {
  primary: { bg: colors.brand, fg: colors.onBrand, elevate: true },
  secondary: { bg: colors.brandBg, fg: colors.brandInk },
  danger: { bg: colors.slaRedBg, fg: colors.slaRed },
  ghost: { bg: colors.card, fg: colors.ink, border: colors.line2 },
};

export function Button({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary",
  size = "md",
  icon,
  fullWidth,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
  /**
   * Sem passar: comportamento contextual (largura cheia numa coluna, abraca o
   * conteudo numa linha — herda a centralizacao vertical do pai). Passe `true`
   * pra forcar largura cheia; `false` pra forcar abracar o conteudo.
   */
  fullWidth?: boolean;
}) {
  const v = BTN[variant];
  const sm = size === "sm";
  const inativo = !!loading || !!disabled;
  return (
    <Pressable
      onPress={inativo ? undefined : onPress}
      disabled={inativo}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inativo, busy: !!loading }}
      style={({ pressed }) => [
        styles.btnBase,
        sm ? styles.btnSm : styles.btnMd,
        { backgroundColor: v.bg },
        v.border ? { borderWidth: 1, borderColor: v.border } : null,
        v.elevate && !inativo ? shadow.brand : null,
        fullWidth === true ? { alignSelf: "stretch" } : fullWidth === false ? { alignSelf: "flex-start" } : null,
        pressed && styles.btnPressed,
        inativo && styles.btnInativo,
      ]}
    >
      {/* O spinner entra NO LUGAR do icone, nunca do rotulo. Trocar a linha
          inteira por um ActivityIndicator deixava 9 telas com um spinner mudo
          — e apagava os proprios rotulos de progresso que o app ja escrevia
          ("Enviando…", "Salvando…"). De quebra, o botao encolhia no meio do
          toque, porque o spinner e mais estreito que o texto. */}
      <View style={styles.btnRow}>
        {loading ? <ActivityIndicator color={v.fg} size="small" /> : icon}
        <Text style={[sm ? styles.btnLabelSm : styles.btnLabelMd, { color: v.fg }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dobravel: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
    ...shadow.sm,
  },
  // minHeight 56: alvo de toque generoso — e um cabecalho que se toca de luva.
  dobravelCabeca: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  dobravelResumo: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  dobravelSeta: { fontSize: 12, color: colors.muted },
  dobravelCorpo: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },

  screen: { flex: 1, backgroundColor: colors.ground },
  screenInner: { flex: 1, paddingHorizontal: space.lg },
  title: { fontSize: font.size.xxxl, fontWeight: font.weight.black as "800", color: colors.ink, letterSpacing: -0.6 },
  muted: { fontSize: font.size.sm, color: colors.ink2 },
  sectionLabel: { fontSize: font.size.xs, fontWeight: font.weight.bold as "700", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.5 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    ...shadow.sm,
  },

  field: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 13,
    fontSize: font.size.base,
    color: colors.ink,
  },

  pill: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  pillTxt: { fontSize: font.size.xs, fontWeight: font.weight.bold as "700", letterSpacing: 0.2 },

  // ALVO DE TOQUE: os 44 abaixo (Chip, Segmented, Button sm) nao sao enfeite de
  // acessibilidade — sao "Autorizar"/"Remover" de ONU, PPPoE x Bridge e a troca
  // de aba. Quem toca neles esta de luva, no sol, com uma mao so, muitas vezes
  // em cima de escada. Abaixo de 44 o erro de toque numa OLT sai caro.
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.brandBg, borderColor: colors.brand },
  chipTxt: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink2 },
  chipTxtActive: { color: colors.brandInk },

  segTrack: { flexDirection: "row", gap: space.xs, backgroundColor: colors.line2, borderRadius: radius.pill, padding: space.xs },
  segItem: { flex: 1, minHeight: 44, paddingVertical: 9, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  segItemActive: { backgroundColor: colors.card },
  segLabel: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink2 },
  segLabelActive: { color: colors.brandInk, fontWeight: font.weight.bold as "700" },

  btnBase: { borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  btnMd: { paddingVertical: 15, paddingHorizontal: space.xl },
  btnSm: { minHeight: 44, paddingVertical: 9, paddingHorizontal: space.lg },
  btnRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  btnPressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  btnInativo: { opacity: 0.55 },
  btnLabelMd: { fontSize: 16, fontWeight: font.weight.bold as "700", letterSpacing: 0.2 },
  btnLabelSm: { fontSize: 14, fontWeight: font.weight.bold as "700", letterSpacing: 0.2 },

  hero: {
    backgroundColor: colors.brand,
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    overflow: "hidden",
    ...shadow.brand,
  },
  heroRings: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  heroRing: { position: "absolute", borderRadius: 999, borderWidth: 2, borderColor: "rgba(255,255,255,0.14)" },
  heroRingA: { width: 150, height: 150, top: -60, right: -30 },
  heroRingB: { width: 100, height: 100, top: -35, right: -5 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  heroTitle: { fontSize: font.size.xxl, fontWeight: font.weight.black as "800", color: colors.onBrand, letterSpacing: -0.5 },
  heroSub: { fontSize: font.size.sm, color: "rgba(255,255,255,0.82)", marginTop: 2, fontWeight: font.weight.medium as "600" },

  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  iconBtnBrand: { backgroundColor: colors.brandBg },
  iconBtnOnBrand: { backgroundColor: "rgba(255,255,255,0.18)" },
});
