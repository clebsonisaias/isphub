import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { FilaItem } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { apiFetch, buildFilaQuery } from "@/lib/api";
import { Muted, Screen, Title } from "@/components/ui";
import { colors, space } from "@/theme/tokens";
import { FilaCard } from "@/features/minhas-os/fila-card";
import { ordenarSlaFirst } from "@/features/minhas-os/sla";

interface FilaResp {
  itens: FilaItem[];
  total: number;
  truncado: boolean;
}

/**
 * Minhas OS (CORE) — fila pessoal do tecnico (escopo ja feito no servidor),
 * ordenada SLA-first, com pull-to-refresh. O card so tem cor na urgencia.
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

  const itens = ordenarSlaFirst(query.data?.itens ?? []);

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Title>Minhas OS</Title>
        <Muted>{query.data ? `${query.data.total} ${query.data.total === 1 ? "aberta" : "abertas"}` : "carregando…"}</Muted>
      </View>

      {query.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : (
        <FlatList
          data={itens}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xxl }}
          refreshControl={
            <RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={() => query.refetch()} tintColor={colors.brand} />
          }
          ListEmptyComponent={
            <Muted>{query.isError ? "Não foi possível carregar a fila." : "Nenhuma OS atribuída a você."}</Muted>
          }
          renderItem={({ item }) => <FilaCard item={item} onPress={() => router.push(`/minhas-os/${item.id}`)} />}
        />
      )}
    </Screen>
  );
}
