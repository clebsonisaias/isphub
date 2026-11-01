import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { destinoDoPapel } from "@/lib/destino";
import { colors } from "@/theme/tokens";

/**
 * Porta de entrada: enquanto restaura a sessao, splash; depois o papel decide —
 * tecnico nas telas nativas, o resto no painel (ver lib/destino.ts).
 */
export default function Index() {
  const { token, usuario, carregando } = useAuth();
  if (carregando) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ground }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  return <Redirect href={token ? destinoDoPapel(usuario?.role) : "/login"} />;
}
