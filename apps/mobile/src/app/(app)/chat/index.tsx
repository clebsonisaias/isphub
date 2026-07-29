import { useEffect } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { IconButton, Muted, Screen, Title } from "@/components/ui";
import { colors, space } from "@/theme/tokens";
import { ConversaRow } from "@/features/chat/conversa-row";
import { useConversas, useCriarConversa } from "@/features/chat/hooks";

export default function ChatLista() {
  const { usuario } = useAuth();
  const router = useRouter();
  const query = useConversas();
  const { garantirAvisos } = useCriarConversa();

  // Bootstrap do canal Avisos — mesma ideia do ChatPage.tsx do web: garante que
  // o usuario vira participante mesmo na primeira vez que abre o chat.
  useEffect(() => {
    garantirAvisos.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Title>Chat</Title>
        <IconButton label="Nova conversa" onPress={() => router.push("/chat/nova")}>
          <Feather name="edit-3" size={18} color={colors.brand} />
        </IconButton>
      </View>

      {query.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : (
        <FlatList
          data={query.data ?? []}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} tintColor={colors.brand} />}
          ListEmptyComponent={
            <Muted style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
              {query.isError ? "Não foi possível carregar as conversas." : "Nenhuma conversa ainda."}
            </Muted>
          }
          renderItem={({ item }) => (
            <ConversaRow
              conversa={item}
              meuId={usuario!.id}
              meuNome={usuario!.nome}
              onPress={() => router.push(`/chat/${item.id}`)}
            />
          )}
        />
      )}
    </Screen>
  );
}
