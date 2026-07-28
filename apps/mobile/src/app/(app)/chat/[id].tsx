import { useEffect, useRef, useState } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Mensagem } from "@isphub/shared";
import { ConversaTipo, UserRole } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Muted } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { Avatar } from "@/features/chat/avatar";
import { MessageBubble } from "@/features/chat/message-bubble";
import { Composer } from "@/features/chat/composer";
import { useAcoesChat, useConversas, useMensagens, type EnviarMensagemInput, type RespostaRapidaTipo } from "@/features/chat/hooks";
import { rotuloDia, tituloConversa, tituloPresenca } from "@/features/chat/format";
import { enfileirarMensagemPendente } from "@/features/chat/outbox";
import { useDigitando } from "@/lib/realtime";

const RESPOSTAS_RAPIDAS: { tipo: RespostaRapidaTipo; label: string }[] = [
  { tipo: "a_caminho", label: "A caminho" },
  { tipo: "cheguei", label: "Cheguei" },
  { tipo: "cliente_ausente", label: "Cliente ausente" },
  { tipo: "preciso_apoio", label: "Preciso de apoio" },
];

export default function ChatThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { usuario } = useAuth();
  const conversasQuery = useConversas();
  const conversa = conversasQuery.data?.find((c) => c.id === id);
  const mensagensQuery = useMensagens(id);
  const acoes = useAcoesChat(id);
  const [respondendoA, setRespondendoA] = useState<{ id: string; autorNome: string | null; resumo: string } | null>(null);
  const [digitandoNome, setDigitandoNome] = useState<string | null>(null);
  const listRef = useRef<FlatList<Mensagem>>(null);
  const digitandoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const meuId = usuario!.id;
  const souTecnico = usuario!.role === UserRole.TECNICO;
  const ehAdmin = usuario!.role === UserRole.ADMIN;
  const ehAvisos = conversa?.tipo === ConversaTipo.AVISOS;
  const podeEnviar = !ehAvisos || ehAdmin || usuario!.role === UserRole.GESTOR;

  // Mensagens vem do servidor mais-recente-primeiro (paginacao por cursor);
  // pra thread normal (mais recente embaixo) inverte pra ordem cronologica.
  const mensagens = [...(mensagensQuery.data ?? [])].reverse();

  useEffect(() => {
    if (mensagens.length > 0) acoes.marcarLida.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mensagens.length]);

  useDigitando(id, (autorId) => {
    if (autorId === meuId) return;
    const p = conversa?.participantes.find((x) => x.usuarioId === autorId);
    setDigitandoNome(p?.nome ?? "Alguém");
    if (digitandoTimeoutRef.current) clearTimeout(digitandoTimeoutRef.current);
    digitandoTimeoutRef.current = setTimeout(() => setDigitandoNome(null), 4000);
  });

  async function handleCopiar(texto: string | undefined | null) {
    if (!texto) return;
    await Clipboard.setStringAsync(texto);
  }

  /** Sem rede -> cai pra fila offline em vez de mostrar erro (mesmo espirito da fila de evidencias). */
  async function handleEnviar(input: EnviarMensagemInput) {
    try {
      await acoes.enviar.mutateAsync(input);
    } catch {
      await enfileirarMensagemPendente(id, input);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: conversa ? tituloConversa(conversa) : "Conversa",
        }}
      />

      <View style={styles.subHeader}>
        {conversa && <Avatar nome={conversa.titulo} online={conversa.tipo === ConversaTipo.DIRETA ? conversa.participantes.find((p) => p.usuarioId !== meuId)?.online : undefined} size="sm" />}
        <Text style={styles.subHeaderTexto} numberOfLines={1}>
          {digitandoNome ? `${digitandoNome} está digitando…` : conversa ? tituloPresenca(conversa, meuId) : ""}
        </Text>
      </View>

      {mensagensQuery.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : mensagens.length === 0 ? (
        <Muted style={{ padding: space.lg, textAlign: "center" }}>Nenhuma mensagem ainda. Diga oi!</Muted>
      ) : (
        <FlatList
          ref={listRef}
          data={mensagens}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingVertical: space.md }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item, index }) => {
            const anterior = mensagens[index - 1];
            const novoDia = !anterior || rotuloDia(anterior.criadoEm) !== rotuloDia(item.criadoEm);
            const mostrarAvatar = !anterior || anterior.autor?.usuarioId !== item.autor?.usuarioId || novoDia;
            const souEu = item.autor?.usuarioId === meuId;
            return (
              <View>
                {novoDia && (
                  <View style={styles.diaWrap}>
                    <Text style={styles.diaTexto}>{rotuloDia(item.criadoEm)}</Text>
                  </View>
                )}
                <MessageBubble
                  mensagem={item}
                  souEu={souEu}
                  mostrarAvatar={mostrarAvatar}
                  podeApagar={souEu || ehAdmin}
                  onReagir={(emoji) => acoes.reagir.mutate({ mensagemId: item.id, emoji })}
                  onResponder={() => setRespondendoA({ id: item.id, autorNome: item.autor?.nome ?? null, resumo: item.corpo ?? "Mensagem" })}
                  onApagar={() => acoes.apagar.mutate(item.id)}
                  onCopiar={() => handleCopiar(item.corpo)}
                />
              </View>
            );
          }}
        />
      )}

      {conversa?.tipo === ConversaTipo.OS && souTecnico && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={{ gap: space.xs, paddingHorizontal: space.md }}>
          {RESPOSTAS_RAPIDAS.map((r) => (
            <Pressable key={r.tipo} onPress={() => acoes.respostaRapida.mutate(r.tipo)} style={styles.chip}>
              <Text style={styles.chipTexto}>{r.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Composer
        respondendoA={respondendoA}
        onCancelarResposta={() => setRespondendoA(null)}
        onEnviar={handleEnviar}
        onDigitando={() => acoes.digitando.mutate()}
        podeEnviar={podeEnviar}
        motivoBloqueio="Só admin/gestor pode postar no canal de Avisos."
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  subHeader: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.card },
  subHeaderTexto: { flex: 1, fontSize: font.size.sm, color: colors.ink2 },
  diaWrap: { alignItems: "center", marginVertical: space.sm },
  diaTexto: { fontSize: font.size.xs, color: colors.muted, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.line },
  chipsRow: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card, paddingVertical: space.sm },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandBg, paddingHorizontal: space.md, paddingVertical: space.xs },
  chipTexto: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.brandInk },
});
