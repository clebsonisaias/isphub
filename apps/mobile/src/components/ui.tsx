import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, font, radius, space } from "@/theme/tokens";

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

export function Button({
  label,
  onPress,
  loading,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: "primary" | "ghost";
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [styles.btn, primary ? styles.btnPrimary : styles.btnGhost, pressed && styles.btnPressed]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onBrand : colors.ink} />
      ) : (
        <Text style={[styles.btnLabel, primary ? styles.btnLabelPrimary : styles.btnLabelGhost]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  screenInner: { flex: 1, paddingHorizontal: space.lg },
  title: { fontSize: font.size.xxl, fontWeight: "700", color: colors.ink, letterSpacing: -0.4 },
  muted: { fontSize: font.size.sm, color: colors.ink2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
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
  btn: { borderRadius: radius.md, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: colors.brand },
  btnGhost: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line2 },
  btnPressed: { opacity: 0.85 },
  btnLabel: { fontSize: font.size.lg, fontWeight: "600" },
  btnLabelPrimary: { color: colors.onBrand },
  btnLabelGhost: { color: colors.ink },
});
