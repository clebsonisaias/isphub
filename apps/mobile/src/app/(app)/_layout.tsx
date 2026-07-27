import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { useModulos } from "@/lib/config";
import { ROTAS_MODULO } from "@/lib/modulo-registry";
import { colors } from "@/theme/tokens";

/**
 * Grupo autenticado. A navegacao e montada DINAMICAMENTE a partir da config:
 * so vira tab o modulo `habilitado ∩ implementado` (ver modulo-registry).
 * Guarda de auth: sem token -> login. Core sempre presente (fallback em useModulos).
 */
export default function AppLayout() {
  const { token, carregando } = useAuth();
  const { modulos } = useModulos();

  if (carregando) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ground }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;

  const tabs = modulos.filter((m) => ROTAS_MODULO[m.id]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line },
      }}
    >
      {tabs.map((m) => (
        <Tabs.Screen key={m.id} name={ROTAS_MODULO[m.id]!.rota} options={{ title: m.nome }} />
      ))}
    </Tabs>
  );
}
