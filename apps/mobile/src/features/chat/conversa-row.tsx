import { Pressable, StyleSheet, Text, View } from "react-native";
import { ConversaTipo, type ConversaResumo } from "@isphub/shared";
import { colors, font, radius, space } from "@/theme/tokens";
import { Avatar } from "./avatar";
import { formatHoraOuData, previewMensagem, tituloConversa } from "./format";

/** Linha da lista de conversas — mesma filosofia SLA-first do FilaCard: cor so no que importa (badge de nao-lidas). */
export function ConversaRow({ conversa, meuId, meuNome, onPress }: { conversa: ConversaResumo; meuId: string; meuNome: string; onPress: () => void }) {
  const outro = conversa.tipo === ConversaTipo.DIRETA ? conversa.participantes.find((p) => p.usuarioId !== meuId) : undefined;
  const naoLido = conversa.naoLidas > 0;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Avatar nome={conversa.titulo} online={conversa.tipo === ConversaTipo.DIRETA ? outro?.online : undefined} />
      <View style={styles.conteudo}>
        <View style={styles.linhaTopo}>
          <Text style={styles.titulo} numberOfLines={1}>
            {tituloConversa(conversa)}
          </Text>
          {conversa.ultimaMensagem && <Text style={styles.hora}>{formatHoraOuData(conversa.ultimaMensagem.criadoEm)}</Text>}
        </View>
        <View style={styles.linhaTopo}>
          <Text style={[styles.preview, naoLido && styles.previewNaoLido]} numberOfLines={1}>
            {previewMensagem(conversa, meuNome)}
          </Text>
          {naoLido && (
            <View style={styles.badge}>
              <Text style={styles.badgeTexto}>{conversa.naoLidas > 9 ? "9+" : conversa.naoLidas}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md },
  pressed: { backgroundColor: colors.ground },
  conteudo: { flex: 1, minWidth: 0, gap: 2 },
  linhaTopo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  titulo: { flex: 1, fontSize: font.size.base, fontWeight: font.weight.medium as "600", color: colors.ink },
  hora: { fontSize: font.size.xs, color: colors.muted, fontVariant: ["tabular-nums"] },
  preview: { flex: 1, fontSize: font.size.sm, color: colors.ink2 },
  previewNaoLido: { color: colors.ink, fontWeight: font.weight.medium as "600" },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeTexto: { fontSize: font.size.xs, fontWeight: font.weight.bold as "700", color: colors.onBrand },
});
