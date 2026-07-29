import { useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { FilaItem } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { apiFetch, buildFilaQuery } from "@/lib/api";
import { Hero, Muted, Screen } from "@/components/ui";
import { colors, font, radius, shadow, space } from "@/theme/tokens";
import { Avatar, useAvatarUri } from "@/features/chat/avatar";
import { FilaCard } from "@/features/minhas-os/fila-card";
import { ordenarSlaFirst } from "@/features/minhas-os/sla";

interface FilaResp {
  itens: FilaItem[];
  total: number;
  truncado: boolean;
}

/** Um contador do topo — a cor É o dado (semaforo de SLA), nunca decoracao. */
function StatTile({ n, label, tone }: { n: number; label: string; tone: "brand" | "green" | "amber" }) {
  const cor = tone === "green" ? colors.slaGreen : tone === "amber" ? colors.slaAmber : colors.brand;
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileNum, { color: cor }]}>{n}</Text>
      <Text style={styles.tileLbl}>{label}</Text>
    </View>
  );
}

/**
 * Minhas OS (CORE) — fila pessoal do tecnico (escopo ja feito no servidor),
 * ordenada SLA-first, com pull-to-refresh. Hero de saudacao + contadores de
 * SLA no topo; o card so tem cor na urgencia.
 */
export default function MinhasOs() {
  const { token, usuario } = useAuth();
  const router = useRouter();
  const [sincronizando, setSincronizando] = useState(false);
  const query = useQuery({
    queryKey: ["fila", "minhas-os"],
    enabled: !!token,
    queryFn: () =>
      apiFetch<FilaResp>(`/fila${buildFilaQuery({ equipe: "interna", grupo: "abertos" })}`, { token }),
  });

  const itens = ordenarSlaFirst(query.data?.itens ?? []);
  const fotoUri = useAvatarUri(usuario?.id, usuario?.temFoto, usuario?.fotoVersao);
  const primeiroNome = ((usuario?.nomeExibicao || usuario?.nome) ?? "").trim().split(/\s+/)[0];

  const abertas = query.data?.total ?? itens.length;
  const noPrazo = itens.filter((i) => i.sla.semaforo === "verde").length;
  const atrasando = itens.filter((i) => i.sla.semaforo === "amarelo" || i.sla.semaforo === "vermelho").length;

  // Pull-to-refresh: dispara um sync sob demanda no SGP (SGP -> ISPhub) e depois
  // re-busca a fila. Rate-limit e falha do sync sao best-effort — a fila
  // recarrega de qualquer jeito.
  async function sincronizarERecarregar() {
    setSincronizando(true);
    try {
      await apiFetch("/sync/minhas-os", { method: "POST", token }).catch(() => {});
      await query.refetch();
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <View style={styles.heroWrap}>
        <Hero
          title={`Olá${primeiroNome ? `, ${primeiroNome}` : ""}`}
          subtitle="Sua fila de hoje"
          right={usuario ? <Avatar nome={usuario.nome} fotoUri={fotoUri} size="lg" /> : undefined}
          style={{ paddingBottom: space.xxl }}
        />
      </View>

      <View style={styles.statsRow}>
        <StatTile n={abertas} label="Abertas" tone="brand" />
        <StatTile n={noPrazo} label="No prazo" tone="green" />
        <StatTile n={atrasando} label="Atrasando" tone="amber" />
      </View>

      {query.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : (
        <FlatList
          data={itens}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl }}
          refreshControl={
            <RefreshControl refreshing={sincronizando} onRefresh={sincronizarERecarregar} tintColor={colors.brand} />
          }
          ListEmptyComponent={
            <Muted>{query.isError ? "Não foi possível carregar a fila." : "Nenhuma OS atribuída a você."}</Muted>
          }
          renderItem={({ item }) => <FilaCard item={item} onPress={() => router.push(`/minhas-os/${item.id}`)} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroWrap: { paddingHorizontal: space.lg, paddingTop: space.sm },
  statsRow: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, marginTop: -space.xl, marginBottom: space.sm },
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, paddingVertical: space.md, paddingHorizontal: space.md, gap: 1, ...shadow.sm },
  tileNum: { fontSize: 24, fontWeight: font.weight.black as "800", letterSpacing: -0.5 },
  tileLbl: { fontSize: font.size.xs, color: colors.ink2, fontWeight: font.weight.medium as "600" },
});
