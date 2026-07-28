import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import type { ModuloId } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { useModulos } from "@/lib/config";
import { useRealtime } from "@/lib/realtime";
import { ROTAS_MODULO } from "@/lib/modulo-registry";
import { ModuloIcon } from "@/lib/modulo-icones";
import { colors } from "@/theme/tokens";

/**
 * Grupo autenticado. A navegacao e montada DINAMICAMENTE a partir da config:
 * so vira tab o modulo `habilitado ∩ implementado` (ver modulo-registry).
 * Guarda de auth: sem token -> login. Core sempre presente (fallback em useModulos).
 */
export default function AppLayout() {
  const { token, carregando } = useAuth();
  const { modulos } = useModulos();
  useRealtime(); // canal SSE ao vivo enquanto o tecnico esta logado

  if (carregando) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ground }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;

  const tabs = modulos.filter((m) => ROTAS_MODULO[m.id]);
  const habilitadas = new Set(tabs.map((m) => m.id));
  // Toda rota implementada que NAO esta habilitada pro usuario precisa ser
  // escondida explicitamente (href: null) — senao o expo-router monta uma tab
  // automatica com o nome cru da pasta (ex.: "provisionamento" quando o modulo
  // esta desligado). So `adicionar` as habilitadas nao basta.
  const ocultas = (Object.keys(ROTAS_MODULO) as ModuloId[]).filter((id) => !habilitadas.has(id));

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
        <Tabs.Screen
          key={m.id}
          name={ROTAS_MODULO[m.id]!.rota}
          options={{
            title: m.nome,
            tabBarIcon: ({ color, size }) => <ModuloIcon id={m.id} color={color} size={size} />,
          }}
        />
      ))}
      {ocultas.map((id) => (
        <Tabs.Screen key={id} name={ROTAS_MODULO[id]!.rota} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
