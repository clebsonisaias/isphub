import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { FilaItem } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { apiFetch, buildFilaQuery } from "@/lib/api";
import { Muted, Screen, Title } from "@/components/ui";
import { colors, corSla, font, radius, space } from "@/theme/tokens";

interface FilaResp {
  itens: FilaItem[];
  total: number;
  truncado: boolean;
}

/**
 * Minhas OS (CORE) — stub do incremento 2: prova a cadeia auth -> API -> render
 * com o escopo do tecnico ja feito no servidor. O card SLA-first completo
 * (ordenacao, acoes, pull-to-refresh) chega no incremento 3.
 */
export default function MinhasOs() {
  const { token } = useAuth();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["fila", "minhas-os"],
    enabled: !!token,
    queryFn: () =>
      apiFetch<FilaResp>(`/fila${buildFilaQuery({ equipe: "interna", grupo: "abertos" })}`, { token }),
  });

  return (
    <Screen>
      <View style={{ paddingVertical: space.md }}>
        <Title>Minhas OS</Title>
        <Muted>{query.data ? `${query.data.total} abertas` : "carregando…"}</Muted>
      </View>

      {query.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : query.isError ? (
        <Muted>Não foi possível carregar a fila.</Muted>
      ) : (
        <FlatList
          data={query.data?.itens ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}
          ListEmptyComponent={<Muted>Nenhuma OS atribuída a você.</Muted>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/minhas-os/${item.id}`)}
              style={{
                backgroundColor: colors.card,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.line,
                borderLeftWidth: 5,
                borderLeftColor: corSla(item.sla.semaforo),
                padding: space.lg,
              }}
            >
              <Text style={{ fontSize: font.size.base, fontWeight: "700", color: colors.ink }}>
                {item.categoria?.nome ?? "Não classificado"}
              </Text>
              <Text style={{ fontSize: font.size.base, color: colors.ink, marginTop: 2 }}>
                {item.clienteNome ?? "Cliente não identificado"}
              </Text>
              {item.endereco.cidade || item.pop ? (
                <Muted>{item.endereco.cidade ?? `POP: ${item.pop}`}</Muted>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
