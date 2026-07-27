import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { OrdemServico } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Card, Muted, Screen, Title } from "@/components/ui";
import { colors, font, space } from "@/theme/tokens";

/**
 * Detalhe da OS — stub do incremento 2 (busca o registro completo e mostra o
 * basico). Conexao ONU, historico, fotos e acoes de write-back chegam no
 * incremento 3.
 */
export default function DetalheOs() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const query = useQuery({
    queryKey: ["os", id],
    enabled: !!token && !!id,
    queryFn: () => apiFetch<OrdemServico>(`/ordens-servico/${id}`, { token }),
  });

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "OS" }} />
      {query.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : query.isError || !query.data ? (
        <Muted>Não foi possível carregar a OS.</Muted>
      ) : (
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.md }}>
          <View>
            <Muted>{query.data.categoria?.nome ?? "Não classificado"}</Muted>
            <Title>{query.data.clienteNome ?? "Cliente não identificado"}</Title>
          </View>
          <Card>
            <Text style={{ fontSize: font.size.base, color: colors.ink }}>
              {query.data.endereco.logradouro
                ? `${query.data.endereco.logradouro}${query.data.endereco.numero ? `, ${query.data.endereco.numero}` : ""}`
                : query.data.pop
                  ? `POP: ${query.data.pop}`
                  : "Endereço não informado"}
            </Text>
            {query.data.endereco.cidade ? <Muted>{query.data.endereco.cidade}</Muted> : null}
          </Card>
          {query.data.conteudo ? (
            <Card>
              <Text style={{ fontSize: font.size.base, color: colors.ink2, lineHeight: 22 }}>{query.data.conteudo}</Text>
            </Card>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
