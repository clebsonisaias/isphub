import { useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { CANAL_WHATSAPP_LABEL, CanalWhatsapp, OrigemConversaCliente, type ConversaClienteResumo, type FiltroConversaCliente } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Card, IconButton, Muted, Pill, Screen, Segmented } from "@/components/ui";
import { colors, font, space } from "@/theme/tokens";
import { useConversasClientes, usePodeSupervisionar } from "@/features/cliente-chat/hooks";

function textoVazio(filtro: FiltroConversaCliente, podeSupervisionar: boolean): string {
  if (!podeSupervisionar) {
    return "Você ainda não iniciou nenhuma conversa. Toque em Nova conversa (canto superior) para escolher um modelo aprovado — aqui aparecem só as conversas que você mesmo iniciar.";
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
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
          <Text style={styles.heading} numberOfLines={1}>Conversas com clientes</Text>
          <IconButton label="Iniciar conversa com cliente" onPress={() => router.push("/chat-clientes/nova")}>
            <Feather name="edit-3" size={18} color={colors.brand} />
          </IconButton>
        </View>
        {podeSupervisionar && (
          <Segmented
            value={aba}
            onChange={(v) => setAba(v)}
            options={[
              { value: "fila", label: "Fila" },
              { value: "minhas", label: "Minhas" },
              { value: "todas", label: "Todas" },
            ]}
          />
        )}
      </View>

      {query.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : (
        <FlatList
          data={query.data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.xs, gap: space.md, paddingBottom: space.xxl }}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} tintColor={colors.brand} />}
          ListEmptyComponent={
            <Muted style={{ marginTop: space.lg }}>
              {query.isError ? "Não foi possível carregar as conversas." : textoVazio(filtro, podeSupervisionar)}
            </Muted>
          }
          renderItem={({ item }) => {
            const rodape = rodapeConversa(item, usuario!.id);
            return (
              <Pressable onPress={() => router.push(`/chat-clientes/${item.id}`)} style={({ pressed }) => pressed && { opacity: 0.9 }}>
                <Card style={{ gap: 3 }}>
                  <View style={styles.convTop}>
                    <Text style={styles.convNome} numberOfLines={1}>{item.nomeContato ?? item.telefone}</Text>
                    {/* Nunca verde/ambar/vermelho aqui: no resto do app essas
                        cores querem dizer SLA e sinal optico. Pintar "canal =
                        Meta" de verde faz cada conversa parecer um item
                        saudavel numa lista onde a cor deveria significar risco. */}
                    <Pill label={CANAL_WHATSAPP_LABEL[item.canal]} tone={item.canal === CanalWhatsapp.META ? "brand" : "teal"} />
                  </View>
                  <Muted numberOfLines={1}>{item.ultimaMensagem?.corpo ?? "Sem mensagens"}</Muted>
                  {rodape ? <Muted style={{ fontSize: font.size.xs }}>{rodape}</Muted> : null}
                </Card>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { flex: 1, fontSize: font.size.xl, fontWeight: font.weight.black as "800", color: colors.ink, letterSpacing: -0.4 },
  convTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  convNome: { flex: 1, fontSize: font.size.base, fontWeight: font.weight.bold as "700", color: colors.ink },
});
