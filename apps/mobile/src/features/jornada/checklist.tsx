import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Button, Field } from "@/components/ui";
import { colors, radius, space } from "@/theme/tokens";
import { comprimirImagem, escolherFoto } from "@/features/chat/media";

/**
 * O CHECKLIST da viatura — na saida (km do painel + foto + combustivel) e no
 * retorno (km + combustivel + avarias). E o que mantem o odometro vivo: o
 * rastreador nao tem odometro, e a manutencao por km depende desta leitura.
 *
 * Tudo opcional e "Pular" sempre a vista: o turno abre com ou sem foto. O que
 * NAO e aceito e km menor que o anterior — isso o servidor recusa sozinho.
 */
export interface ChecklistViatura {
  combustivelPct?: number | null;
  avarias?: string | null;
  fotoPainel?: string | null;
  fotoMime?: string | null;
}

const NIVEIS: { pct: number; rotulo: string }[] = [
  { pct: 10, rotulo: "Reserva" },
  { pct: 25, rotulo: "1/4" },
  { pct: 50, rotulo: "1/2" },
  { pct: 75, rotulo: "3/4" },
  { pct: 100, rotulo: "Cheio" },
];

export function FolhaChecklist({
  visivel,
  momento,
  viatura,
  kmAnterior,
  ocupado,
  onFechar,
  onConfirmar,
}: {
  visivel: boolean;
  momento: "saida" | "retorno";
  /** "C011 · RGI-4H16" — pra pessoa saber de que carro e o km. */
  viatura: string | null;
  /** Ultima leitura conhecida, pra conferencia (nao trava). */
  kmAnterior?: number | null;
  ocupado?: boolean;
  onFechar: () => void;
  onConfirmar: (dados: { odometro: number | null; checklist: ChecklistViatura | null }) => void;
}) {
  const insets = useSafeAreaInsets();
  const [km, setKm] = useState("");
  const [combustivel, setCombustivel] = useState<number | null>(null);
  const [avarias, setAvarias] = useState("");
  const [foto, setFoto] = useState<{ base64: string; mime: string } | null>(null);
  const [tirando, setTirando] = useState(false);

  async function tirarFoto() {
    setTirando(true);
    try {
      const uri = await escolherFoto("camera");
      if (!uri) return;
      setFoto(await comprimirImagem(uri));
    } finally {
      setTirando(false);
    }
  }

  const kmNum = km.trim() ? Number(km.replace(/\D/g, "")) : null;
  const kmMenor = kmNum != null && kmAnterior != null && kmNum < kmAnterior;

  function confirmar() {
    const checklist: ChecklistViatura | null =
      combustivel != null || avarias.trim() || foto
        ? { combustivelPct: combustivel, avarias: avarias.trim() || null, fotoPainel: foto?.base64 ?? null, fotoMime: foto?.mime ?? null }
        : null;
    onConfirmar({ odometro: kmNum, checklist });
  }

  return (
    <Modal transparent visible={visivel} animationType="slide" onRequestClose={onFechar}>
      <Pressable style={e.fundo} onPress={onFechar} accessibilityLabel="Fechar" />
      <View style={[e.folha, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <View style={e.puxador} />
        <Text style={e.titulo}>{momento === "saida" ? "Antes de sair" : "Antes de encerrar"}</Text>
        {viatura ? <Text style={e.sub}>{viatura}</Text> : null}

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
          <View style={{ gap: 6 }}>
            <Text style={e.rotulo}>Km do painel</Text>
            <Field
              value={km}
              onChangeText={setKm}
              keyboardType="number-pad"
              placeholder={kmAnterior != null ? `última leitura ${kmAnterior.toLocaleString("pt-BR")} km` : "ex.: 84230"}
              accessibilityLabel="Km do painel"
            />
            {kmMenor ? <Text style={e.aviso}>Menor que a última leitura — confira o número.</Text> : null}
          </View>

          <View style={{ gap: 6 }}>
            <Text style={e.rotulo}>Combustível</Text>
            <View style={e.niveis}>
              {NIVEIS.map((n) => {
                const ativo = combustivel === n.pct;
                return (
                  <Pressable
                    key={n.pct}
                    onPress={() => setCombustivel(ativo ? null : n.pct)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: ativo }}
                    style={({ pressed }) => [e.nivel, ativo && e.nivelAtivo, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={[e.nivelTxt, ativo && { color: colors.onBrand }]}>{n.rotulo}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={e.rotulo}>Foto do painel</Text>
            {foto ? (
              <Pressable onPress={() => void tirarFoto()} accessibilityRole="button" accessibilityLabel="Tirar outra foto">
                <Image source={{ uri: `data:${foto.mime};base64,${foto.base64}` }} style={e.foto} />
              </Pressable>
            ) : (
              <Button
                label={tirando ? "Abrindo câmera…" : "Tirar foto do painel"}
                variant="ghost"
                icon={<Feather name="camera" size={16} color={colors.ink} />}
                onPress={() => void tirarFoto()}
                loading={tirando}
                fullWidth
              />
            )}
          </View>

          {momento === "retorno" ? (
            <View style={{ gap: 6 }}>
              <Text style={e.rotulo}>Avarias (se houver)</Text>
              <Field value={avarias} onChangeText={setAvarias} placeholder="Ex.: risco na porta direita" multiline accessibilityLabel="Avarias" />
            </View>
          ) : null}
        </ScrollView>

        <View style={e.rodape}>
          <Button label="Pular" variant="ghost" onPress={() => onConfirmar({ odometro: null, checklist: null })} disabled={ocupado} fullWidth />
          <Button label={ocupado ? "Registrando…" : momento === "saida" ? "Iniciar jornada" : "Encerrar jornada"} onPress={confirmar} disabled={ocupado} loading={ocupado} fullWidth />
        </View>
      </View>
    </Modal>
  );
}

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
  sub: { color: colors.muted, fontSize: 13, marginTop: -4 },
  rotulo: { color: colors.ink2, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  aviso: { color: colors.slaAmber, fontSize: 12 },
  niveis: { flexDirection: "row", gap: 6 },
  nivel: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.cardAlt },
  nivelAtivo: { backgroundColor: colors.brand, borderColor: colors.brand },
  nivelTxt: { color: colors.ink2, fontSize: 12, fontWeight: "600" },
  foto: { width: "100%", height: 160, borderRadius: radius.md, backgroundColor: colors.cardAlt },
  rodape: { flexDirection: "row", gap: space.sm, paddingTop: space.xs },
});
