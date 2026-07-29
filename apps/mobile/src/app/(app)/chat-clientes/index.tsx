import { useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { CANAL_WHATSAPP_LABEL } from "@isphub/shared";
import { Muted, Screen, Title } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { useConversasClientes, type FiltroConversaCliente } from "@/features/cliente-chat/hooks";

function SegmentButton({ label, ativo, onPress }: { label: string; ativo: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        backgroundColor: ativo ? colors.brand : colors.card,
        borderWidth: 1,
        borderColor: ativo ? colors.brand : colors.line,
        alignItems: "center",
      }}
    >
      <Text style={{ fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: ativo ? colors.onBrand : colors.ink2 }}>{label}</Text>
    </Pressable>
  );
}

export default function ClientesChatLista() {
  const router = useRouter();
  const [filtro, setFiltro] = useState<FiltroConversaCliente>("fila");
  const query = useConversasClientes(filtro);

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
        <Title>Conversas com clientes</Title>
        <View style={{ flexDirection: "row", gap: space.xs }}>
          <SegmentButton label="Fila" ativo={filtro === "fila"} onPress={() => setFiltro("fila")} />
          <SegmentButton label="Minhas" ativo={filtro === "minhas"} onPress={() => setFiltro("minhas")} />
        </View>
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
              {query.isError ? "Não foi possível carregar as conversas." : filtro === "fila" ? "Fila vazia." : "Nenhuma conversa sua ainda."}
            </Muted>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/chat-clientes/${item.id}`)}
              style={({ pressed }) => [{ paddingHorizontal: space.lg, paddingVertical: space.sm }, pressed && { backgroundColor: colors.ground }]}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: font.size.base, fontWeight: font.weight.medium as "600", color: colors.ink }}>
                  {item.nomeContato ?? item.telefone}
                </Text>
                <View style={{ backgroundColor: colors.brandBg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: font.size.xs, color: colors.brandInk }}>{CANAL_WHATSAPP_LABEL[item.canal]}</Text>
                </View>
              </View>
              <Muted numberOfLines={1}>{item.ultimaMensagem?.corpo ?? "Sem mensagens"}</Muted>
              {item.agenteNome && <Muted style={{ fontSize: font.size.xs }}>Com {item.agenteNome}</Muted>}
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
