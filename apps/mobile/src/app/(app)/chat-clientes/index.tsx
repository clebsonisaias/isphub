import { useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { CANAL_WHATSAPP_LABEL, OrigemConversaCliente, type ConversaClienteResumo, type FiltroConversaCliente } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Muted, Screen, Title } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { useConversasClientes, usePodeSupervisionar } from "@/features/cliente-chat/hooks";

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

function textoVazio(filtro: FiltroConversaCliente, podeSupervisionar: boolean): string {
  if (!podeSupervisionar) {
    return "Você ainda não iniciou nenhuma conversa. Toque em ✏️ para escolher um modelo aprovado — aqui aparecem só as conversas que você mesmo iniciar.";
  }
  if (filtro === "fila") return "Fila vazia — nenhuma conversa do cliente esperando atendimento.";
  if (filtro === "minhas") return "Nenhuma conversa atribuída a você.";
  return "Nenhuma conversa com cliente ainda.";
}

/**
 * Terceira linha da lista. Pro tecnico ela quase sempre seria "Com <ele mesmo>",
 * ruido puro — por isso so aparece quando aponta pra outra pessoa.
 */
function rodapeConversa(conversa: ConversaClienteResumo, meuId: string): string | null {
  if (conversa.agenteNome && conversa.agenteId !== meuId) return `Com ${conversa.agenteNome}`;
  if (conversa.origem === OrigemConversaCliente.SAIDA && conversa.iniciadaPorNome && conversa.iniciadaPorId !== meuId) {
    return `Iniciada por ${conversa.iniciadaPorNome}`;
  }
  return null;
}

export default function ClientesChatLista() {
  const router = useRouter();
  const { usuario } = useAuth();
  const podeSupervisionar = usePodeSupervisionar();
  const [aba, setAba] = useState<FiltroConversaCliente>("fila");
  // TECNICO nao tem fila: o servidor so devolve as conversas que ele mesmo
  // iniciou, entao escolher aba nao mudaria nada — some com o seletor. E o
  // filtro fixo tem que ser `todas`, nao `minhas`: `minhas` filtra por agenteId
  // e esconderia dele justamente a conversa que ele abriu e foi transferida —
  // que o escopo do servidor (iniciadaPorId) mantem visivel, como no web.
  const filtro: FiltroConversaCliente = podeSupervisionar ? aba : "todas";
  const query = useConversasClientes(filtro);

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Title>Conversas com clientes</Title>
          <Pressable onPress={() => router.push("/chat-clientes/nova")} hitSlop={8}>
            <Text style={{ fontSize: font.size.xl }}>✏️</Text>
          </Pressable>
        </View>
        {podeSupervisionar && (
          <View style={{ flexDirection: "row", gap: space.xs }}>
            <SegmentButton label="Fila" ativo={aba === "fila"} onPress={() => setAba("fila")} />
            <SegmentButton label="Minhas" ativo={aba === "minhas"} onPress={() => setAba("minhas")} />
            <SegmentButton label="Todas" ativo={aba === "todas"} onPress={() => setAba("todas")} />
          </View>
        )}
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
              {query.isError ? "Não foi possível carregar as conversas." : textoVazio(filtro, podeSupervisionar)}
            </Muted>
          }
          renderItem={({ item }) => {
            const rodape = rodapeConversa(item, usuario!.id);
            return (
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
                {rodape && <Muted style={{ fontSize: font.size.xs }}>{rodape}</Muted>}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
