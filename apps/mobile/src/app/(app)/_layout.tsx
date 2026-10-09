import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import type { ModuloId } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { useModulos } from "@/lib/config";
import { useRealtime } from "@/lib/realtime";
import { usePush } from "@/features/notificacoes/push-hook";
import { useNaoLidas } from "@/features/chat/hooks";
import { useProcessarFilaEvidencias } from "@/features/evidencias/outbox";
import { ROTAS_MODULO } from "@/lib/modulo-registry";
import { ModuloIcon } from "@/lib/modulo-icones";
import { colors } from "@/theme/tokens";

/**
 * Grupo autenticado. A navegacao e montada DINAMICAMENTE a partir da config:
 * so vira tab o modulo `habilitado ∩ implementado` (ver modulo-registry).
 * Guarda de auth: sem token -> login. Core sempre presente (fallback em useModulos).
 */
const TITULO_ABA: Partial<Record<string, string>> = { "chat-clientes": "Clientes" };

export default function AppLayout() {
  const { token, carregando } = useAuth();
  const { modulos } = useModulos();
  useRealtime(); // canal SSE ao vivo enquanto o tecnico esta logado
  usePush(); // notificacao no aparelho — o unico canal que chega com o app fechado
  useProcessarFilaEvidencias(); // fotos offline sobem daqui, nao so com o detalhe da OS aberto
  const naoLidas = useNaoLidas().data?.naoLidas ?? 0;

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
            // O nome do modulo e o do admin ("Conversas com clientes"); na
            // aba ele saia cortado em "Conversas ...".
            title: TITULO_ABA[m.id] ?? m.nome,
            tabBarIcon: ({ color, size }) => <ModuloIcon id={m.id} color={color} size={size} />,
            // Sem isto o tecnico so descobria mensagem nova ABRINDO a aba —
            // `useNaoLidas` ja existia e nao era consumido em lugar nenhum.
            ...(m.id === "chat" && naoLidas > 0 ? { tabBarBadge: naoLidas > 99 ? "99+" : naoLidas } : {}),
          }}
        />
      ))}
      {ocultas.map((id) => (
        <Tabs.Screen key={id} name={ROTAS_MODULO[id]!.rota} options={{ href: null }} />
      ))}
      {/* Perfil/conta NAO e modulo de negocio — sempre presente, independente
          dos toggles do admin em /admin/modulos. */}
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
