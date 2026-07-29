import { useState } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CANAL_WHATSAPP_LABEL, CanalWhatsapp, MensagemClienteDirecao, type MensagemClienteDTO } from "@isphub/shared";
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
  usePodeSupervisionar,
} from "@/features/cliente-chat/hooks";

/**
 * `souAutor` decide se o nome aparece: numa conversa de saida todas as bolhas
 * da direita sao da equipe, e o tecnico precisa enxergar quando quem escreveu
 * foi o gestor intervindo — sem o nome as duas mensagens sao identicas.
 */
function Bolha({ mensagem, souAutor }: { mensagem: MensagemClienteDTO; souAutor: boolean }) {
  const saida = mensagem.direcao === MensagemClienteDirecao.SAIDA;
  const corTextoSecundario = saida ? colors.onBrand : colors.muted;
  return (
    <View style={{ alignItems: saida ? "flex-end" : "flex-start", paddingHorizontal: space.md, marginBottom: 6 }}>
      <View
        style={{
          maxWidth: "78%",
          borderRadius: radius.lg,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          backgroundColor: saida ? colors.brand : colors.card,
          borderWidth: saida ? 0 : 1,
          borderColor: colors.line,
        }}
      >
        {saida && !souAutor && mensagem.autorNome && (
          <Text style={[styles.autor, { color: colors.onBrand }]}>{mensagem.autorNome}</Text>
        )}
        {mensagem.templateNome && (
          <Text style={[styles.selo, { color: corTextoSecundario }]}>Modelo {mensagem.templateNome}</Text>
        )}
        <Text style={{ fontSize: font.size.base, color: saida ? colors.onBrand : colors.ink }}>{mensagem.corpo}</Text>
        {mensagem.falhaEnvio && <Text style={{ fontSize: font.size.xs, color: colors.slaRed, marginTop: 2 }}>Falha ao enviar: {mensagem.falhaEnvio}</Text>}
        <Text style={{ fontSize: font.size.xs, color: corTextoSecundario, opacity: 0.8, marginTop: 4, alignSelf: "flex-end" }}>
          {formatHora(mensagem.criadoEm)}
        </Text>
      </View>
    </View>
  );
}

export default function ClienteChatThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { usuario } = useAuth();
  const insets = useSafeAreaInsets();
  const podeSupervisionar = usePodeSupervisionar();
  const [texto, setTexto] = useState("");
  const mensagensQuery = useMensagensCliente(id);
  // Uma listagem so pra achar os metadados da conversa atual (nao ha rota de
  // detalhe): `todas` e o filtro mais largo que o papel permite — pro TECNICO o
  // servidor ja o reduz as conversas que ele iniciou.
  const conversasQuery = useConversasClientes("todas");
  const conversa = (conversasQuery.data ?? []).find((c) => c.id === id);
  const enviar = useEnviarMensagemCliente(id);
  const assumir = useAssumirConversaCliente();
  const encerrar = useEncerrarConversaCliente();

  const jaAssumida = !!conversa?.agenteId;
  const souDono = conversa?.agenteId === usuario?.id;
  /** ADMIN/GESTOR escrevem sem tomar a conversa — o dono continua sendo o atendente. */
  const intervindo = jaAssumida && !souDono && podeSupervisionar;
  const podeEscrever = !jaAssumida || souDono || podeSupervisionar;
  // Janela de 24h e regra da Meta; no Evolution nao existe e bloquear seria mentira.
  // So AVISA, nao bloqueia: `dentroJanela24h` sai do nosso proprio historico,
  // entao um webhook nao entregue nos faria calcular "fora da janela" numa
  // conversa em que o cliente acabou de escrever, trancando o tecnico fora dela.
  // A recusa da Meta ja aparece na bolha via `falhaEnvio`. Mesmo criterio do web.
  const foraDaJanela = conversa?.canal === CanalWhatsapp.META && !conversa.dentroJanela24h;

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
    // Ver nota na thread do chat interno: o composer fica no fundo do KAV, entao
    // offset 0 o encosta no teclado; o bug era o Android sem behavior nao reagir.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
      <Screen style={{ paddingHorizontal: 0 }}>
        <Stack.Screen options={{ headerShown: true, title: conversa?.nomeContato ?? conversa?.telefone ?? "Conversa" }} />

        <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Muted>{conversa ? CANAL_WHATSAPP_LABEL[conversa.canal] : ""}</Muted>
            {intervindo && <Muted style={{ fontSize: font.size.xs }}>Atendida por {conversa?.agenteNome} — você está intervindo.</Muted>}
          </View>
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
            renderItem={({ item }) => <Bolha mensagem={item} souAutor={item.autorId === usuario?.id} />}
            ListEmptyComponent={<Muted style={{ paddingHorizontal: space.lg }}>Nenhuma mensagem ainda.</Muted>}
          />
        )}

        {foraDaJanela && (
          <Muted style={{ paddingHorizontal: space.lg, fontSize: font.size.xs }}>
            A Meta só entrega texto livre até 24h depois da última mensagem do cliente. Fora disso, apenas modelo aprovado.
          </Muted>
        )}

        <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm + insets.bottom, alignItems: "center", borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card }}>
          <Field
            value={texto}
            onChangeText={setTexto}
            placeholder={
              !podeEscrever
                ? "Assuma a conversa para responder"
                : foraDaJanela
                  ? "Fora da janela de 24h — pode ser recusado"
                  : intervindo
                    ? `Intervir na conversa de ${conversa?.agenteNome}…`
                    : "Mensagem…"
            }
            style={{ flex: 1 }}
            editable={podeEscrever}
          />
          <Button label={enviar.isPending ? "…" : "Enviar"} onPress={handleEnviar} loading={enviar.isPending} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  autor: { fontSize: font.size.xs, fontWeight: font.weight.medium as "600", marginBottom: 2, opacity: 0.9 },
  selo: { fontSize: font.size.xs, marginBottom: 2, opacity: 0.8 },
});
