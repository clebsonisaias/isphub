import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RecordingPresets, IOSOutputFormat, AudioQuality, useAudioRecorder, useAudioRecorderState, requestRecordingPermissionsAsync } from "expo-audio";
import { MensagemTipo } from "@isphub/shared";
import { colors, font, radius, space } from "@/theme/tokens";
import { comprimirImagem, escolherFoto, obterLocalizacaoAtual } from "./media";
import type { EnviarMensagemInput } from "./hooks";

const LIMITE_AUDIO_SEG = 55; // um pouco abaixo do limite de 60s do servidor, de proposito

/** ~64kbps mono m4a: ~470KB em 55s, cabe no limite de 500KB do servidor (HIGH_QUALITY estouraria). */
const OPCOES_GRAVACAO = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1 as const,
  bitRate: 64000,
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
  },
};

export function Composer({
  respondendoA,
  onCancelarResposta,
  onEnviar,
  onDigitando,
  podeEnviar,
  motivoBloqueio,
}: {
  respondendoA: { id: string; autorNome: string | null; resumo: string } | null;
  onCancelarResposta: () => void;
  onEnviar: (input: EnviarMensagemInput) => void;
  onDigitando: () => void;
  podeEnviar: boolean;
  motivoBloqueio?: string;
}) {
  const insets = useSafeAreaInsets();
  const [texto, setTexto] = useState("");
  const [processando, setProcessando] = useState(false);
  const recorder = useAudioRecorder(OPCOES_GRAVACAO);
  const estadoGravacao = useAudioRecorderState(recorder, 250);
  const parandoPorLimiteRef = useRef(false);

  function enviarTexto() {
    const corpo = texto.trim();
    if (!corpo) return;
    setTexto("");
    onEnviar({ tipo: MensagemTipo.TEXTO, corpo, respondendoAId: respondendoA?.id });
    onCancelarResposta();
  }

  async function processarFoto(uri: string) {
    setProcessando(true);
    try {
      const { base64, mime } = await comprimirImagem(uri);
      onEnviar({ tipo: MensagemTipo.FOTO, anexoBase64: base64, anexoMime: mime, respondendoAId: respondendoA?.id });
      onCancelarResposta();
    } catch {
      Alert.alert("Não foi possível processar a foto");
    } finally {
      setProcessando(false);
    }
  }

  async function selecionarEProcessar(fonte: "camera" | "galeria") {
    const uri = await escolherFoto(fonte);
    if (uri) await processarFoto(uri);
  }

  function handleAnexarFoto() {
    Alert.alert("Foto", "Escolher origem", [
      { text: "Câmera", onPress: () => void selecionarEProcessar("camera") },
      { text: "Galeria", onPress: () => void selecionarEProcessar("galeria") },
      { text: "Cancelar", style: "cancel" },
    ]);
  }

  async function handleLocalizacao() {
    setProcessando(true);
    try {
      const pos = await obterLocalizacaoAtual();
      if (!pos) {
        Alert.alert("Permissão de localização negada");
        return;
      }
      onEnviar({ tipo: MensagemTipo.LOCALIZACAO, lat: pos.lat, lng: pos.lng, respondendoAId: respondendoA?.id });
      onCancelarResposta();
    } catch {
      Alert.alert("Não foi possível obter sua localização");
    } finally {
      setProcessando(false);
    }
  }

  async function iniciarGravacao() {
    const permissao = await requestRecordingPermissionsAsync();
    if (!permissao.granted) {
      Alert.alert("Permissão de microfone negada");
      return;
    }
    parandoPorLimiteRef.current = false;
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function pararGravacao(cancelar: boolean) {
    const duracaoSeg = Math.round(estadoGravacao.durationMillis / 1000);
    await recorder.stop();
    if (cancelar || !recorder.uri || duracaoSeg === 0) return;
    setProcessando(true);
    try {
      const { readAsStringAsync, EncodingType } = await import("expo-file-system/legacy");
      const base64 = await readAsStringAsync(recorder.uri, { encoding: EncodingType.Base64 });
      onEnviar({ tipo: MensagemTipo.AUDIO, anexoBase64: base64, anexoMime: "audio/m4a", duracaoSeg, respondendoAId: respondendoA?.id });
      onCancelarResposta();
    } catch {
      Alert.alert("Não foi possível enviar o áudio");
    } finally {
      setProcessando(false);
    }
  }

  // Corta a gravacao sozinho perto do limite do servidor, evitando um audio
  // rejeitado por tamanho. A ref trava o disparo em UMA vez so — sem ela,
  // cada re-render (a cada 250ms, via useAudioRecorderState) chamaria
  // pararGravacao de novo antes do primeiro `await recorder.stop()` resolver.
  if (estadoGravacao.isRecording && estadoGravacao.durationMillis / 1000 >= LIMITE_AUDIO_SEG && !parandoPorLimiteRef.current) {
    parandoPorLimiteRef.current = true;
    void pararGravacao(false);
  }

  if (!podeEnviar) {
    return (
      <View style={[styles.bloqueado, { paddingBottom: space.md + insets.bottom }]}>
        <Text style={styles.bloqueadoTexto}>{motivoBloqueio ?? "Você não pode enviar mensagens nesta conversa."}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]}>
      {respondendoA && (
        <View style={styles.respostaBar}>
          <View style={styles.respostaTexto}>
            <Text style={styles.respostaAutor} numberOfLines={1}>
              {respondendoA.autorNome ?? "Mensagem"}
            </Text>
            <Text style={styles.respostaResumo} numberOfLines={1}>
              {respondendoA.resumo}
            </Text>
          </View>
          <Pressable
            onPress={onCancelarResposta}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cancelar resposta"
          >
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
      )}

      <View style={styles.linha}>
        {estadoGravacao.isRecording ? (
          <View style={styles.gravando}>
            <View style={styles.gravandoPonto} />
            <Text style={styles.gravandoTexto}>
              {String(Math.floor(estadoGravacao.durationMillis / 60000)).padStart(2, "0")}:
              {String(Math.floor(estadoGravacao.durationMillis / 1000) % 60).padStart(2, "0")}
            </Text>
            <Text style={styles.gravandoMuted}>Gravando áudio…</Text>
          </View>
        ) : (
          <>
            <Pressable
              onPress={handleAnexarFoto}
              disabled={processando}
              style={styles.botaoIcone}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Anexar foto"
            >
              <Ionicons name="camera-outline" size={24} color={colors.ink2} />
            </Pressable>
            <Pressable
              onPress={handleLocalizacao}
              disabled={processando}
              style={styles.botaoIcone}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Enviar minha localização"
            >
              <Ionicons name="location-outline" size={24} color={colors.ink2} />
            </Pressable>
            <TextInput
              value={texto}
              onChangeText={(v) => {
                setTexto(v);
                onDigitando();
              }}
              placeholder="Escreva uma mensagem…"
              placeholderTextColor={colors.muted}
              style={styles.campo}
              multiline
            />
          </>
        )}

        {processando ? (
          <ActivityIndicator color={colors.brand} style={styles.botaoEnviar} />
        ) : estadoGravacao.isRecording ? (
          <>
            <Pressable
              onPress={() => pararGravacao(true)}
              style={styles.botaoIcone}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Cancelar gravação"
            >
              <Ionicons name="close" size={24} color={colors.ink2} />
            </Pressable>
            <Pressable
              onPress={() => pararGravacao(false)}
              style={styles.botaoEnviarBrand}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Enviar áudio"
            >
              <Ionicons name="stop" size={20} color={colors.onBrand} />
            </Pressable>
          </>
        ) : texto.trim() ? (
          <Pressable
            onPress={enviarTexto}
            style={styles.botaoEnviarBrand}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Enviar mensagem"
          >
            <Ionicons name="send" size={18} color={colors.onBrand} />
          </Pressable>
        ) : (
          <Pressable
            onPress={iniciarGravacao}
            style={styles.botaoIcone}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Gravar áudio"
          >
            <Ionicons name="mic-outline" size={24} color={colors.ink2} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card },
  bloqueado: { padding: space.md, alignItems: "center" },
  bloqueadoTexto: { fontSize: font.size.sm, color: colors.muted, textAlign: "center" },
  respostaBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colors.ground,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  respostaTexto: { flex: 1, borderLeftWidth: 2, borderLeftColor: colors.brand, paddingLeft: space.sm },
  respostaAutor: { fontSize: font.size.xs, fontWeight: font.weight.medium as "600", color: colors.ink },
  respostaResumo: { fontSize: font.size.xs, color: colors.ink2 },
  respostaFechar: { fontSize: font.size.base, color: colors.muted, padding: space.xs },
  linha: { flexDirection: "row", alignItems: "flex-end", gap: space.xs, padding: space.sm },
  botaoIcone: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  icone: { fontSize: font.size.xl },
  campo: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: colors.ground,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: font.size.base,
    color: colors.ink,
  },
  botaoEnviar: { width: 40, height: 40 },
  botaoEnviarBrand: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  botaoEnviarTexto: { color: colors.onBrand, fontSize: font.size.lg },
  gravando: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.slaRedBg, borderRadius: radius.lg, paddingHorizontal: space.md, height: 40 },
  gravandoPonto: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.slaRed },
  gravandoTexto: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.slaRed, fontVariant: ["tabular-nums"] },
  gravandoMuted: { fontSize: font.size.xs, color: colors.ink2 },
});
