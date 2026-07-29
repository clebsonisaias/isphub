import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useQuery } from "@tanstack/react-query";
import { EMOJIS_REACAO, MensagemTipo, OS_STATUS_LABEL, type Mensagem } from "@isphub/shared";
import { apiFetch, API_BASE, baixarAnexoAutenticado } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, font, radius, space } from "@/theme/tokens";
import { Avatar, useAvatarUri } from "./avatar";
import { formatHora } from "./format";
import { urlAnexo } from "./hooks";
import type { OrdemServico } from "@isphub/shared";


function OsRefCard({ ordemServicoId }: { ordemServicoId: string }) {
  const { token } = useAuth();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["os", ordemServicoId],
    queryFn: () => apiFetch<OrdemServico>(`/ordens-servico/${ordemServicoId}`, { token }),
  });

  if (query.isLoading) return <View style={[styles.osCard, { height: 80 }]} />;
  if (!query.data) return <Text style={styles.textoMuted}>OS não encontrada.</Text>;
  const os = query.data;

  return (
    <Pressable onPress={() => router.push(`/minhas-os/${os.id}`)} style={styles.osCard}>
      <View style={styles.osCardTopo}>
        <Text style={styles.osCardId}>OS #{os.sgpOsId}</Text>
        <View style={styles.osCardStatusPill}>
          <Text style={styles.osCardStatusTexto}>{OS_STATUS_LABEL[os.status]}</Text>
        </View>
      </View>
      {os.clienteNome && <Text style={styles.osCardCliente}>{os.clienteNome}</Text>}
      {os.endereco?.logradouro && (
        <Text style={styles.osCardEndereco} numberOfLines={1}>
          {os.endereco.logradouro}
          {os.endereco.bairro ? ` — ${os.endereco.bairro}` : ""}
        </Text>
      )}
      <Text style={styles.osCardAbrir}>Abrir OS →</Text>
    </Pressable>
  );
}

function AudioBubble({ mensagemId, duracaoSeg }: { mensagemId: string; duracaoSeg?: number | null }) {
  const { token } = useAuth();
  const [uriLocal, setUriLocal] = useState<string | null>(null);
  const player = useAudioPlayer(uriLocal ?? undefined);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    let vivo = true;
    baixarAnexoAutenticado(urlAnexo(mensagemId), token)
      .then((uri) => vivo && setUriLocal(uri))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [mensagemId, token]);

  function alternar() {
    if (!uriLocal) return;
    if (status.playing) player.pause();
    else player.play();
  }

  return (
    <Pressable onPress={alternar} style={styles.audioRow} disabled={!uriLocal}>
      <Text style={styles.audioIcone}>{status.playing ? "⏸" : "▶"}</Text>
      <View style={styles.audioBarra} />
      <Text style={styles.audioDuracao}>
        {String(Math.floor((duracaoSeg ?? 0) / 60)).padStart(2, "0")}:{String((duracaoSeg ?? 0) % 60).padStart(2, "0")}
      </Text>
    </Pressable>
  );
}

function MenuMensagem({
  visivel,
  onFechar,
  onReagir,
  onResponder,
  podeApagar,
  onApagar,
  temTexto,
  onCopiar,
}: {
  visivel: boolean;
  onFechar: () => void;
  onReagir: (emoji: string) => void;
  onResponder: () => void;
  podeApagar: boolean;
  onApagar: () => void;
  temTexto: boolean;
  onCopiar: () => void;
}) {
  return (
    <Modal transparent visible={visivel} animationType="fade" onRequestClose={onFechar}>
      <Pressable style={styles.modalFundo} onPress={onFechar}>
        <View style={styles.menu}>
          <View style={styles.menuEmojis}>
            {EMOJIS_REACAO.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => {
                  onReagir(emoji);
                  onFechar();
                }}
                style={styles.menuEmojiBtn}
              >
                <Text style={{ fontSize: 22 }}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              onResponder();
              onFechar();
            }}
          >
            <Text style={styles.menuItemTexto}>Responder</Text>
          </Pressable>
          {temTexto && (
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                onCopiar();
                onFechar();
              }}
            >
              <Text style={styles.menuItemTexto}>Copiar</Text>
            </Pressable>
          )}
          {podeApagar && (
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                onApagar();
                onFechar();
              }}
            >
              <Text style={[styles.menuItemTexto, { color: colors.slaRed }]}>Apagar</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

export function MessageBubble({
  mensagem,
  souEu,
  mostrarAvatar,
  podeApagar,
  onReagir,
  onResponder,
  onApagar,
  onCopiar,
}: {
  mensagem: Mensagem;
  souEu: boolean;
  mostrarAvatar: boolean;
  podeApagar: boolean;
  onReagir: (emoji: string) => void;
  onResponder: () => void;
  onApagar: () => void;
  onCopiar: () => void;
}) {
  const { token } = useAuth();
  const [menuAberto, setMenuAberto] = useState(false);
  const apagada = !!mensagem.apagadoEm;
  const sistema = mensagem.tipo === MensagemTipo.SISTEMA;
  const fotoAutorUri = useAvatarUri(mensagem.autor?.usuarioId, mensagem.autor?.temFoto, mensagem.autor?.fotoVersao);

  if (sistema) {
    return (
      <View style={styles.sistemaWrap}>
        <Text style={styles.sistemaTexto}>{mensagem.corpo}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.linha, souEu && styles.linhaInvertida]}>
      <View style={styles.avatarSlot}>{!souEu && mostrarAvatar && mensagem.autor && <Avatar nome={mensagem.autor.nome} fotoUri={fotoAutorUri} size="sm" />}</View>

      <Pressable
        onLongPress={() => !apagada && setMenuAberto(true)}
        style={[styles.bolha, souEu ? styles.bolhaMinha : styles.bolhaOutro, apagada && styles.bolhaApagada]}
      >
        {!souEu && mostrarAvatar && mensagem.autor && <Text style={styles.nomeAutor}>{mensagem.autor.nome}</Text>}

        {mensagem.respondendoA && !apagada && (
          <View style={styles.citacao}>
            <Text style={styles.citacaoAutor}>{mensagem.respondendoA.autorNome ?? "Mensagem"}</Text>
            <Text style={styles.citacaoTexto} numberOfLines={1}>
              {mensagem.respondendoA.resumo}
            </Text>
          </View>
        )}

        {apagada ? (
          <Text style={styles.textoApagado}>Mensagem apagada</Text>
        ) : mensagem.tipo === MensagemTipo.OS_REF && mensagem.ordemServicoId ? (
          <OsRefCard ordemServicoId={mensagem.ordemServicoId} />
        ) : mensagem.tipo === MensagemTipo.FOTO ? (
          <View style={{ gap: 4 }}>
            <Image
              source={{ uri: `${API_BASE}${urlAnexo(mensagem.id)}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
              style={styles.foto}
              resizeMode="cover"
            />
            {mensagem.corpo && <Text style={styles.texto}>{mensagem.corpo}</Text>}
          </View>
        ) : mensagem.tipo === MensagemTipo.AUDIO ? (
          <AudioBubble mensagemId={mensagem.id} duracaoSeg={mensagem.duracaoSeg} />
        ) : mensagem.tipo === MensagemTipo.LOCALIZACAO && mensagem.lat != null && mensagem.lng != null ? (
          <Pressable onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${mensagem.lat},${mensagem.lng}`)}>
            <Text style={styles.linkTexto}>📍 Localização compartilhada</Text>
          </Pressable>
        ) : (
          <Text style={styles.texto}>{mensagem.corpo}</Text>
        )}

        {!apagada && mensagem.tipo === MensagemTipo.TEXTO && mensagem.autor?.assinaturaChat && (
          <Text style={styles.assinatura}>{mensagem.autor.assinaturaChat}</Text>
        )}

        <Text style={styles.hora}>
          {formatHora(mensagem.criadoEm)}
          {mensagem.editadoEm && !apagada ? " · editado" : ""}
        </Text>
      </Pressable>

      {mensagem.reacoes.length > 0 && (
        <View style={styles.reacoesRow}>
          {mensagem.reacoes.map((r) => (
            <Pressable key={r.emoji} onPress={() => onReagir(r.emoji)} style={styles.reacaoChip}>
              <Text style={styles.reacaoTexto}>
                {r.emoji} {r.usuarioIds.length}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <MenuMensagem
        visivel={menuAberto}
        onFechar={() => setMenuAberto(false)}
        onReagir={onReagir}
        onResponder={onResponder}
        podeApagar={podeApagar}
        onApagar={onApagar}
        temTexto={!!mensagem.corpo}
        onCopiar={onCopiar}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, paddingHorizontal: space.md, marginBottom: 2 },
  linhaInvertida: { flexDirection: "row-reverse" },
  avatarSlot: { width: 28 },
  bolha: { maxWidth: "78%", borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  bolhaMinha: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bolhaOutro: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  bolhaApagada: { opacity: 0.7 },
  nomeAutor: { fontSize: font.size.xs, fontWeight: font.weight.medium as "600", color: colors.ink2, marginBottom: 2 },
  texto: { fontSize: font.size.base, color: colors.ink },
  textoMuted: { fontSize: font.size.sm, color: colors.muted },
  textoApagado: { fontSize: font.size.base, fontStyle: "italic", color: colors.muted },
  hora: { fontSize: font.size.xs, color: colors.muted, marginTop: 4, alignSelf: "flex-end" },
  assinatura: { fontSize: font.size.xs, fontStyle: "italic", color: colors.muted, marginTop: 2 },
  linkTexto: { fontSize: font.size.base, color: colors.brand, textDecorationLine: "underline" },
  citacao: { borderLeftWidth: 2, borderLeftColor: colors.line2, paddingLeft: space.sm, marginBottom: space.sm, opacity: 0.85 },
  citacaoAutor: { fontSize: font.size.xs, fontWeight: font.weight.medium as "600", color: colors.ink2 },
  citacaoTexto: { fontSize: font.size.xs, color: colors.ink2 },
  foto: { width: 220, height: 220, borderRadius: radius.md, backgroundColor: colors.ground },
  audioRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 160 },
  audioIcone: { fontSize: font.size.lg, color: colors.ink },
  audioBarra: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.line2 },
  audioDuracao: { fontSize: font.size.xs, color: colors.ink2, fontVariant: ["tabular-nums"] },
  osCard: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space.sm, gap: 2, minWidth: 200 },
  osCardTopo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  osCardId: { fontSize: font.size.xs, fontWeight: font.weight.bold as "700", color: colors.ink },
  osCardCliente: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink },
  osCardEndereco: { fontSize: font.size.xs, color: colors.ink2 },
  osCardAbrir: { fontSize: font.size.xs, fontWeight: font.weight.medium as "600", color: colors.brand, marginTop: 4 },
  osCardStatusPill: { backgroundColor: colors.ground, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  osCardStatusTexto: { fontSize: font.size.xs, fontWeight: font.weight.medium as "600", color: colors.ink2 },
  reacoesRow: { flexDirection: "row", gap: 4, marginTop: 2, paddingHorizontal: space.sm },
  reacaoChip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 6, paddingVertical: 2 },
  reacaoTexto: { fontSize: font.size.xs, color: colors.ink },
  sistemaWrap: { alignItems: "center", paddingVertical: 4 },
  sistemaTexto: { fontSize: font.size.xs, color: colors.muted, backgroundColor: colors.ground, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  modalFundo: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  menu: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.md, gap: space.xs },
  menuEmojis: { flexDirection: "row", justifyContent: "space-around", paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: space.xs },
  menuEmojiBtn: { padding: space.xs },
  menuItem: { paddingVertical: space.sm },
  menuItemTexto: { fontSize: font.size.base, color: colors.ink },
});
