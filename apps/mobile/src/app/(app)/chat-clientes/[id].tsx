import { useState } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { CANAL_WHATSAPP_LABEL, MensagemClienteDirecao, type MensagemClienteDTO } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Button, Field, Muted, Screen } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { formatHora } from "@/features/chat/format";
import {
  useAssumirConversaCliente,
  useConversasClientes,
  useEncerrarConversaCliente,
  useEnviarMensagemCliente,
  useMensagensCliente,
} from "@/features/cliente-chat/hooks";

function Bolha({ mensagem }: { mensagem: MensagemClienteDTO }) {
  const souSaida = mensagem.direcao === MensagemClienteDirecao.SAIDA;
  return (
    <View style={{ alignItems: souSaida ? "flex-end" : "flex-start", paddingHorizontal: space.md, marginBottom: 6 }}>
      <View
        style={{
          maxWidth: "78%",
          borderRadius: radius.lg,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          backgroundColor: souSaida ? colors.brand : colors.card,
          borderWidth: souSaida ? 0 : 1,
          borderColor: colors.line,
        }}
      >
        <Text style={{ fontSize: font.size.base, color: souSaida ? colors.onBrand : colors.ink }}>{mensagem.corpo}</Text>
        {mensagem.falhaEnvio && <Text style={{ fontSize: font.size.xs, color: colors.slaRed, marginTop: 2 }}>Falha ao enviar: {mensagem.falhaEnvio}</Text>}
        <Text style={{ fontSize: font.size.xs, color: souSaida ? colors.onBrand : colors.muted, opacity: 0.8, marginTop: 4, alignSelf: "flex-end" }}>
          {formatHora(mensagem.criadoEm)}
        </Text>
      </View>
    </View>
  );
}

export default function ClienteChatThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { usuario } = useAuth();
  const [texto, setTexto] = useState("");
  const mensagensQuery = useMensagensCliente(id);
  // Reaproveita a lista da fila+minhas pra achar os metadados da conversa atual sem uma rota de detalhe dedicada.
  const conversasFila = useConversasClientes("fila");
  const conversasMinhas = useConversasClientes("minhas");
  const conversa = [...(conversasFila.data ?? []), ...(conversasMinhas.data ?? [])].find((c) => c.id === id);
  const enviar = useEnviarMensagemCliente(id);
  const assumir = useAssumirConversaCliente();
  const encerrar = useEncerrarConversaCliente();

  const jaAssumida = !!conversa?.agenteId;
  const souEuQueAssumi = conversa?.agenteId === usuario?.id;

  function handleEnviar() {
    const corpo = texto.trim();
    if (!corpo) return;
    setTexto("");
    enviar.mutate(corpo);
  }

  function handleEncerrar() {
    Alert.alert("Encerrar conversa", "Arquivar esta conversa com o cliente?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Encerrar", style: "destructive", onPress: () => encerrar.mutate(id) },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Screen style={{ paddingHorizontal: 0 }}>
        <Stack.Screen options={{ headerShown: true, title: conversa?.nomeContato ?? conversa?.telefone ?? "Conversa" }} />

        <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Muted>{conversa ? CANAL_WHATSAPP_LABEL[conversa.canal] : ""}</Muted>
          {jaAssumida ? (
            <Button label="Encerrar" variant="ghost" onPress={handleEncerrar} loading={encerrar.isPending} />
          ) : (
            <Button label={assumir.isPending ? "Assumindo…" : "Assumir"} onPress={() => assumir.mutate(id)} loading={assumir.isPending} />
          )}
        </View>

        {mensagensQuery.isLoading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
        ) : (
          <FlatList
            data={mensagensQuery.data ?? []}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ paddingVertical: space.md }}
            renderItem={({ item }) => <Bolha mensagem={item} />}
            ListEmptyComponent={<Muted style={{ paddingHorizontal: space.lg }}>Nenhuma mensagem ainda.</Muted>}
          />
        )}

        <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, alignItems: "center" }}>
          <Field
            value={texto}
            onChangeText={setTexto}
            placeholder={souEuQueAssumi || !jaAssumida ? "Mensagem…" : "Assuma a conversa para responder"}
            style={{ flex: 1 }}
            editable={souEuQueAssumi || !jaAssumida}
          />
          <Button label={enviar.isPending ? "…" : "Enviar"} onPress={handleEnviar} loading={enviar.isPending} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
