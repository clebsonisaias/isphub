import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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

export function Card({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

export function Field(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.muted} style={styles.field} {...props} />;
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
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.8 }]}>
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
}: {
  children: ReactNode;
  onPress: () => void;
  /** brand = circulo indigo suave (sobre fundo claro); onBrand = translucido (dentro do Hero). */
  tone?: "brand" | "onBrand";
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
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
      {loading ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : (
        <View style={styles.btnRow}>
          {icon}
          <Text style={[sm ? styles.btnLabelSm : styles.btnLabelMd, { color: v.fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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

  chip: {
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
  segItem: { flex: 1, paddingVertical: 9, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  segItemActive: { backgroundColor: colors.card },
  segLabel: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink2 },
  segLabelActive: { color: colors.brandInk, fontWeight: font.weight.bold as "700" },

  btnBase: { borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  btnMd: { paddingVertical: 15, paddingHorizontal: space.xl },
  btnSm: { paddingVertical: 9, paddingHorizontal: space.lg },
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
