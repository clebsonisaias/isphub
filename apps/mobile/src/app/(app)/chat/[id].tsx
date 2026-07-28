import { useCallback, useEffect, useRef, useState } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Mensagem } from "@isphub/shared";
import { ConversaTipo, UserRole } from "@isphub/shared";
import { ApiError } from "@/lib/api";
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

  // Mais recente primeiro — a ordem que o servidor devolve e a que um FlatList
  // `inverted` espera. Nao ha mais `.reverse()` no corpo do componente (criava
  // um array novo a cada render e derrubava toda memoizacao da lista).
  const { mensagens } = mensagensQuery;

  useEffect(() => {
    if (mensagens.length > 0) acoes.marcarLida.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mensagens.length]);

  // useCallback: o callback entra no array de dependencias do useEffect dentro
  // de useDigitando — inline, ele era recriado a cada render e a assinatura do
  // listener era desfeita e refeita o tempo todo.
  const aoDigitar = useCallback(
    (autorId: string) => {
      if (autorId === meuId) return;
      const p = conversa?.participantes.find((x) => x.usuarioId === autorId);
      setDigitandoNome(p?.nome ?? "Alguém");
      if (digitandoTimeoutRef.current) clearTimeout(digitandoTimeoutRef.current);
      digitandoTimeoutRef.current = setTimeout(() => setDigitandoNome(null), 4000);
    },
    [meuId, conversa],
  );
  useDigitando(id, aoDigitar);

  // Limpa o timer ao sair da tela — sem isso ele dispara setState em componente
  // ja desmontado toda vez que alguem estava digitando quando voltamos.
  useEffect(() => () => {
    if (digitandoTimeoutRef.current) clearTimeout(digitandoTimeoutRef.current);
  }, []);

  async function handleCopiar(texto: string | undefined | null) {
    if (!texto) return;
    await Clipboard.setStringAsync(texto);
  }

  /**
   * Falha de REDE cai pra fila offline. Erro do SERVIDOR (403/400/429) nao:
   * enfileirar um 403 fazia a mensagem tentar de novo, falhar de novo e ficar
   * orfa na fila, sem nada na tela dizendo isso. `ApiError` so existe quando o
   * servidor respondeu — se respondeu, rede tem.
   */
  async function handleEnviar(input: EnviarMensagemInput) {
    try {
      await acoes.enviar.mutateAsync(input);
    } catch (err) {
      if (err instanceof ApiError) {
        Alert.alert("Não foi possível enviar", err.message);
        return;
      }
      await enfileirarMensagemPendente(id, input);
    }
  }

  /**
   * Memoizado: inline, uma nova funcao a cada render obrigava o FlatList a
   * re-renderizar todas as bolhas a cada evento de "digitando" recebido.
   *
   * Com a lista `inverted` os indices andam ao contrario do tempo: a mensagem
   * cronologicamente ANTERIOR a `index` esta em `index + 1`.
   */
  const renderItem = useCallback(
    ({ item, index }: { item: Mensagem; index: number }) => {
      const anterior = mensagens[index + 1];
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mensagens, meuId, ehAdmin],
  );

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
        /*
         * `inverted` resolve tres problemas de uma vez:
         *  - dispensa o `.reverse()` que rodava a cada render;
         *  - dispensa o `scrollToEnd` em todo `onContentSizeChange`, que jogava
         *    o usuario pro fim mesmo quando ele estava lendo mensagem antiga;
         *  - faz `onEndReached` significar "cheguei no topo" = carregar
         *    historico mais antigo, que e o gesto natural de um chat.
         */
        <FlatList
          ref={listRef}
          inverted
          data={mensagens}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingVertical: space.md }}
          onEndReached={() => {
            if (mensagensQuery.hasNextPage && !mensagensQuery.isFetchingNextPage) {
              void mensagensQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            mensagensQuery.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={{ marginVertical: space.md }} /> : null
          }
          // Aparelho de campo costuma ser modesto: sem estes limites a lista
          // renderiza muito mais bolha do que cabe na tela e engasga.
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={11}
          removeClippedSubviews
          renderItem={renderItem}
        />
      )}

      {conversa?.tipo === ConversaTipo.OS && souTecnico && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={{ gap: space.xs, paddingHorizontal: space.md }}>
          {RESPOSTAS_RAPIDAS.map((r) => (
            <Pressable
              key={r.tipo}
              onPress={() => acoes.respostaRapida.mutate(r.tipo)}
              style={styles.chip}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={r.label}
            >
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
  // minHeight 44: o chip tinha ~26pt de altura, abaixo do minimo recomendado —
  // e e justamente o controle que o tecnico toca de luva, no sol, com uma mao.
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.brandBg,
    paddingHorizontal: space.md,
    minHeight: 44,
    justifyContent: "center",
  },
  chipTexto: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.brandInk },
});
