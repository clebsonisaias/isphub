import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import type { DetalhesTecnicos } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, font, radius, space } from "@/theme/tokens";

/**
 * Status de conexao (online/offline) do contrato, ao vivo, direto no card da
 * fila — espelha o ConexaoBadge do web. Reaproveita GET /conexao/:id/detalhes,
 * que no back tem cache de 90s + limite de concorrencia por provedor: uma fila
 * com dezenas de OS nao vira rajada capaz de travar o SGP do provedor. O
 * `staleTime` do React Query espelha o TTL do back (o mesmo contrato nao e
 * reconsultado a cada re-render/scroll) e, como o FlatList so MONTA os cards
 * visiveis, so eles disparam a consulta. Best-effort: erro nao polui o card.
 *
 * Cor forte SO no offline (atencao — o servico do cliente esta fora). Online
 * fica neutro: a cor do card e reservada a urgencia do SLA, e dois "verdes" com
 * significados diferentes (SLA no prazo x conexao ok) confundiriam.
 */
export function ConexaoBadge({ provedorId, contratoId }: { provedorId: string; contratoId?: string | null }) {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: ["conexao-os", provedorId, contratoId],
    enabled: !!token && !!contratoId,
    staleTime: 90_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: () =>
      apiFetch<DetalhesTecnicos>(`/provedores/${provedorId}/conexao/${encodeURIComponent(contratoId!)}/detalhes`, { token }),
  });

  if (!contratoId) return null;

  const online = query.data?.online;

  // Slot de largura fixa: o badge resolve async, mas o espaco ja fica reservado
  // (skeleton -> badge -> vazio), entao a linha nao re-flui ~1s depois do card
  // aparecer na tela.
  return (
    <View style={styles.slot}>
      {query.isLoading ? (
        <View style={styles.skeleton} />
      ) : online == null ? null : (
        <View style={[styles.badge, online ? styles.on : styles.off]}>
          <Feather name={online ? "wifi" : "wifi-off"} size={11} color={online ? colors.ink2 : colors.slaRed} />
          <Text style={[styles.txt, { color: online ? colors.ink2 : colors.slaRed }]}>{online ? "Online" : "Offline"}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { minWidth: 76, height: 22, justifyContent: "center" },
  skeleton: { width: 68, height: 18, borderRadius: radius.pill, backgroundColor: colors.line },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  on: { backgroundColor: colors.line },
  off: { backgroundColor: colors.slaRedBg },
  txt: { fontSize: font.size.xs, fontWeight: font.weight.bold as "700", letterSpacing: 0.2 },
});
