import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Field } from "@/components/ui";
import { colors, radius, space } from "@/theme/tokens";
import { GaleriaEvidencias } from "@/features/evidencias/galeria";

/**
 * Encerrar a OS num passo so (ideia do app da equipe CITmax): o que foi feito
 * (obrigatorio) + fotos, e so entao "Concluir OS". Antes o tecnico podia
 * concluir sem uma palavra e sem foto — e a OS fechava sem registro do servico.
 *
 * As fotos entram na fila offline da galeria e sobem sozinhas: nao seguram o
 * encerramento quando o sinal esta ruim.
 */
export function FolhaEncerrar({
  visivel,
  osId,
  comFotos,
  ocupado,
  onFechar,
  onConcluir,
}: {
  visivel: boolean;
  osId: string;
  /** Modulo de evidencias ligado pro provedor. */
  comFotos: boolean;
  ocupado?: boolean;
  onFechar: () => void;
  onConcluir: (oQueFoiFeito: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [texto, setTexto] = useState("");
  const pronto = texto.trim().length > 0;

  return (
    <Modal transparent visible={visivel} animationType="slide" onRequestClose={onFechar}>
      <Pressable style={e.fundo} onPress={onFechar} accessibilityLabel="Fechar" />
      <View style={[e.folha, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <View style={e.puxador} />
        <Text style={e.titulo}>Concluir OS</Text>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
          <View style={{ gap: 6 }}>
            <Text style={e.rotulo}>O que foi feito</Text>
            <Field
              value={texto}
              onChangeText={setTexto}
              placeholder="Ex.: troquei o conector, sinal -19 dBm, cliente navegando."
              multiline
              style={{ minHeight: 88 }}
              accessibilityLabel="O que foi feito"
            />
          </View>
          {comFotos ? <GaleriaEvidencias osId={osId} /> : null}
        </ScrollView>

        <View style={e.rodape}>
          <View style={{ flex: 1 }}>
            <Button label="Voltar" variant="ghost" onPress={onFechar} disabled={ocupado} fullWidth />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              label={ocupado ? "Concluindo…" : "Concluir OS"}
              onPress={() => onConcluir(texto.trim())}
              disabled={!pronto || ocupado}
              loading={ocupado}
              fullWidth
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Mesmo desenho das folhas da jornada (features/jornada/checklist.tsx).
const e = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: "rgba(26,29,41,0.45)" },
  folha: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    maxHeight: "88%",
    gap: space.sm,
  },
  puxador: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line2, marginBottom: space.xs },
  titulo: { color: colors.ink, fontSize: 18, fontWeight: "700" },
  rotulo: { color: colors.ink2, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  rodape: { flexDirection: "row", gap: space.sm, paddingTop: space.xs },
});
