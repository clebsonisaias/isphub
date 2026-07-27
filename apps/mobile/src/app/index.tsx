import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { colors } from "@/theme/tokens";

/** Porta de entrada: enquanto restaura a sessao, splash; depois manda pra fila ou pro login. */
export default function Index() {
  const { token, carregando } = useAuth();
  if (carregando) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ground }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  return <Redirect href={token ? "/minhas-os" : "/login"} />;
}
