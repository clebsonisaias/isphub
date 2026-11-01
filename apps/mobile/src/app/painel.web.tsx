import { Linking, Pressable, Text, View } from "react-native";
import { PAINEL_URL } from "@/lib/destino";
import { colors } from "@/theme/tokens";

/**
 * No PWA (build web do app) nao ha WebView: quem nao e tecnico usa o painel
 * direto no navegador.
 */
export default function PainelWeb() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: colors.ground }}>
      <Text style={{ fontSize: 17, fontWeight: "600", color: colors.ink, textAlign: "center" }}>
        Sua conta usa o painel do ISPhub.
      </Text>
      <Pressable
        onPress={() => void Linking.openURL(PAINEL_URL)}
        style={{ minHeight: 48, paddingHorizontal: 24, borderRadius: 12, backgroundColor: colors.brand, justifyContent: "center" }}
        accessibilityRole="link"
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Abrir o painel</Text>
      </Pressable>
    </View>
  );
}
