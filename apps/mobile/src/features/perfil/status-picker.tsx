import { Pressable, StyleSheet, Text, View } from "react-native";
import { STATUS_PRESET_LABEL, StatusPreset } from "@isphub/shared";
import { Field } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";

const OPCOES = Object.values(StatusPreset);

/** 4 chips de status fixo + campo opcional de texto livre complementar. */
export function StatusPicker({
  status,
  statusTexto,
  onMudarStatus,
  onMudarTexto,
}: {
  status: StatusPreset | null;
  statusTexto: string;
  onMudarStatus: (status: StatusPreset | null) => void;
  onMudarTexto: (texto: string) => void;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.chips}>
        {OPCOES.map((opcao) => {
          const ativo = status === opcao;
          return (
            <Pressable
              key={opcao}
              onPress={() => onMudarStatus(ativo ? null : opcao)}
              style={[styles.chip, ativo && styles.chipAtivo]}
            >
              <Text style={[styles.chipTexto, ativo && styles.chipTextoAtivo]}>{STATUS_PRESET_LABEL[opcao]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field
        value={statusTexto}
        onChangeText={onMudarTexto}
        placeholder="Complemento opcional (ex.: cliente X até 15h)"
        maxLength={140}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  chipAtivo: { borderColor: colors.brand, backgroundColor: colors.brandBg },
  chipTexto: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink2 },
  chipTextoAtivo: { color: colors.brandInk },
});
