import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FilaItem } from "@isphub/shared";
import { colors, corSla, font, radius, space } from "@/theme/tokens";
import { textoSla } from "./sla";
import { ConexaoBadge } from "./conexao-badge";

/** Cor de fundo/texto do selo de SLA pelo semaforo. */
function selo(item: FilaItem): { bg: string; fg: string } {
  switch (item.sla.semaforo) {
    case "vermelho":
      return { bg: colors.slaRedBg, fg: colors.slaRed };
    case "amarelo":
      return { bg: colors.slaAmberBg, fg: colors.slaAmber };
    case "verde":
      return { bg: colors.slaGreenBg, fg: colors.slaGreen };
    default:
      return { bg: "#EEF1F6", fg: colors.ink2 };
  }
}

function fmtHora(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Card SLA-first da fila: a faixa lateral e o selo sao a UNICA cor. */
export function FilaCard({ item, onPress }: { item: FilaItem; onPress: () => void }) {
  const s = selo(item);
  const hora = fmtHora(item.dataAgendamento ?? item.dataCadastro ?? item.criadoEm);
  const local = item.endereco.logradouro
    ? `${item.endereco.logradouro}${item.endereco.bairro ? ` — ${item.endereco.bairro}` : ""}`
    : item.endereco.cidade
      ? item.endereco.cidade
      : item.pop
        ? `POP: ${item.pop}`
        : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { borderLeftColor: corSla(item.sla.semaforo) }, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <Text style={styles.osnum}>OS #{item.sgpOsId}</Text>
        <View style={styles.prov}>
          <View style={[styles.dot, { backgroundColor: item.provedor.cor }]} />
          <Text style={styles.provName}>{item.provedor.nome}</Text>
        </View>
      </View>

      <Text style={styles.categoria}>{item.categoria?.nome ?? "Não classificado"}</Text>
      <Text style={styles.cliente}>{item.clienteNome ?? "Cliente não identificado"}</Text>
      {local ? <Text style={styles.addr}>{local}</Text> : null}

      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          {hora ? <Text style={styles.hora}>{hora}</Text> : null}
          <ConexaoBadge provedorId={item.provedorId} contratoId={item.contratoId} />
        </View>
        <View style={[styles.selo, { backgroundColor: s.bg }]}>
          <Text style={[styles.seloTxt, { color: s.fg }]}>{textoSla(item.sla)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 5,
    padding: space.lg,
    gap: 3,
  },
  pressed: { opacity: 0.9 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  osnum: { fontSize: font.size.xs, fontWeight: "600", color: colors.ink2 },
  prov: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  provName: { fontSize: font.size.xs, color: colors.ink2 },
  categoria: { fontSize: font.size.lg, fontWeight: "700", color: colors.ink, letterSpacing: -0.2 },
  cliente: { fontSize: font.size.base, fontWeight: "600", color: colors.ink },
  addr: { fontSize: font.size.sm, color: colors.ink2 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, gap: space.sm },
  metaLeft: { flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1 },
  hora: { fontSize: font.size.sm, color: colors.ink2, fontWeight: "600" },
  selo: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  seloTxt: { fontSize: font.size.xs, fontWeight: "700" },
});
