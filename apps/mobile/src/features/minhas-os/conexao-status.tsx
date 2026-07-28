import { Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError } from "@/lib/api";
import { colors, font, radius, space } from "@/theme/tokens";
import { useVerificarConexao } from "./conexao";

/** Sinal optico da ONU normal fica entre -8 e -27 dBm; fora disso e alerta. */
function sinalOk(dbm: number | null): boolean | null {
  if (dbm == null) return null;
  return dbm <= -8 && dbm >= -27;
}

function mensagemErro(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao consultar o SGP";
}

/**
 * Consulta ao vivo (botao, sob demanda) do status de conexao + sinal da ONU
 * — mesma logica/limites do ConexaoStatus.tsx do web, versao RN. So aparece
 * quando a OS tem contratoId (nem toda OS tem contrato vinculado).
 */
export function ConexaoStatus({ provedorId, contratoId }: { provedorId: string; contratoId?: string | null }) {
  const verificar = useVerificarConexao(provedorId);

  if (!contratoId) return null;

  if (!verificar.data && !verificar.isError) {
    return (
      <Pressable
        onPress={() => verificar.mutate(contratoId)}
        disabled={verificar.isPending}
        style={({ pressed }) => [styles.botao, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.botaoTexto}>{verificar.isPending ? "Consultando SGP…" : "Verificar conexão e sinal"}</Text>
      </Pressable>
    );
  }

  if (verificar.isError) {
    return (
      <Pressable onPress={() => verificar.mutate(contratoId)} style={styles.erroWrap}>
        <Text style={styles.erroTexto}>Não foi possível verificar ({mensagemErro(verificar.error)}) — tentar de novo</Text>
      </Pressable>
    );
  }

  const { online, sinalRxDbm, sinalTxDbm, mensagem } = verificar.data!;
  const okSinal = sinalOk(sinalRxDbm);

  return (
    <View style={styles.pillsRow}>
      <View style={[styles.pill, online === true && styles.pillOk, online === false && styles.pillErro]}>
        <Text style={[styles.pillTexto, online === true && styles.pillTextoOk, online === false && styles.pillTextoErro]}>
          {mensagem ?? "Status indisponível"}
        </Text>
      </View>

      {sinalRxDbm != null && (
        <View style={[styles.pill, okSinal === true && styles.pillOk, okSinal === false && styles.pillAlerta]}>
          <Text style={[styles.pillTexto, okSinal === true && styles.pillTextoOk, okSinal === false && styles.pillTextoAlerta]}>
            Sinal ONU: {sinalRxDbm} dBm{sinalTxDbm != null ? ` (TX ${sinalTxDbm})` : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  botao: {
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    alignSelf: "flex-start",
  },
  botaoTexto: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink },
  erroWrap: { paddingVertical: 4 },
  erroTexto: { fontSize: font.size.xs, color: colors.muted, textDecorationLine: "underline" },
  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  pill: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ground, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillTexto: { fontSize: font.size.xs, fontWeight: font.weight.medium as "600", color: colors.ink2 },
  pillOk: { borderColor: colors.slaGreen, backgroundColor: colors.slaGreenBg },
  pillTextoOk: { color: colors.slaGreen },
  pillErro: { borderColor: colors.slaRed, backgroundColor: colors.slaRedBg },
  pillTextoErro: { color: colors.slaRed },
  pillAlerta: { borderColor: colors.slaAmber, backgroundColor: colors.slaAmberBg },
  pillTextoAlerta: { color: colors.slaAmber },
});
