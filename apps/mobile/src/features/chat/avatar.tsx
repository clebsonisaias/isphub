import { StyleSheet, Text, View } from "react-native";
import { colors, font, radius } from "@/theme/tokens";
import { iniciais } from "./format";

const TAMANHOS = { sm: 28, md: 36, lg: 44 } as const;

/** Avatar circular com iniciais — mesma ideia do Avatar.tsx do web, versao StyleSheet. */
export function Avatar({ nome, size = "md", online }: { nome: string; size?: keyof typeof TAMANHOS; online?: boolean }) {
  const px = TAMANHOS[size];
  return (
    <View style={{ width: px, height: px }}>
      <View style={[styles.circulo, { width: px, height: px, borderRadius: px / 2 }]}>
        <Text style={[styles.letras, { fontSize: px * 0.4 }]}>{iniciais(nome)}</Text>
      </View>
      {online !== undefined && (
        <View
          style={[
            styles.status,
            { backgroundColor: online ? colors.slaGreen : colors.muted, right: -1, bottom: -1 },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circulo: {
    backgroundColor: colors.brandBg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  letras: { fontWeight: font.weight.bold as "700", color: colors.brandInk },
  status: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.card,
  },
});
