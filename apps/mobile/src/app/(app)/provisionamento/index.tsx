import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import type { Olt, Provedor } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Card, Chip, Muted, Screen, SectionLabel } from "@/components/ui";
import { colors, font, space } from "@/theme/tokens";
import { fttxKeys, listarOlts } from "@/features/provisionamento/fttx";

/**
 * Provisionar ONU — passo 1: escolher o PROVEDOR (cada um tem o seu SGP, com as
 * suas OLTs) e depois a OLT. Pode chegar por deep-link de uma OS (provedor ja
 * pre-selecionado + contrato/descricao carregados pro form la na frente).
 */
export default function ProvisionamentoIndex() {
  const { token } = useAuth();
  const router = useRouter();
  const { provedorId: provedorIdParam, contrato, descricao } = useLocalSearchParams<{
    provedorId?: string;
    contrato?: string;
    descricao?: string;
  }>();
  const [provedorId, setProvedorId] = useState<string | null>(provedorIdParam ?? null);

  const provedores = useQuery({
    queryKey: ["provedores"],
    enabled: !!token,
    queryFn: () => apiFetch<Provedor[]>("/provedores", { token }),
  });

  const olts = useQuery({
    queryKey: fttxKeys.olts(provedorId ?? ""),
    enabled: !!token && !!provedorId,
    queryFn: () => listarOlts(provedorId!, token),
  });

  function abrirOlt(olt: Olt) {
    router.push({
      pathname: "/provisionamento/onus",
      params: {
        provedorId: provedorId!,
        oltId: olt.id,
        oltNome: olt.nome,
        ...(contrato ? { contrato } : {}),
        ...(descricao ? { descricao } : {}),
      },
    });
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Provisionar ONU" }} />
      <ScrollView contentContainerStyle={{ gap: space.xl, paddingVertical: space.md, paddingBottom: space.xxl }}>
        <View style={{ gap: space.sm }}>
          <SectionLabel>Provedor</SectionLabel>
          {provedores.isLoading ? (
            <ActivityIndicator color={colors.brand} />
          ) : provedores.data?.length === 0 ? (
            <Muted>Nenhum provedor disponível.</Muted>
          ) : (
            <View style={styles.chips}>
              {(provedores.data ?? []).map((p) => (
                <Chip key={p.id} label={p.nome} active={p.id === provedorId} onPress={() => setProvedorId(p.id)} />
              ))}
            </View>
          )}
        </View>

        {!provedorId ? (
          <Muted>Selecione um provedor para ver as OLTs.</Muted>
        ) : (
          <View style={{ gap: space.sm }}>
            <SectionLabel>OLTs</SectionLabel>
            {olts.isLoading ? (
              <ActivityIndicator color={colors.brand} />
            ) : olts.isError ? (
              <Muted>Não foi possível listar as OLTs deste provedor.</Muted>
            ) : (olts.data ?? []).length === 0 ? (
              <Muted>Nenhuma OLT neste provedor (o SGP pode não ter FTTX habilitado).</Muted>
            ) : (
              olts.data!.map((olt) => (
                <Pressable key={olt.id} onPress={() => abrirOlt(olt)} style={({ pressed }) => pressed && { opacity: 0.85 }}>
                  <Card style={styles.oltCard}>
                    <View style={styles.oltIcon}>
                      <Feather name="server" size={18} color={colors.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.oltNome}>{olt.nome}</Text>
                      {olt.fabricante ? <Muted>{olt.fabricante}</Muted> : null}
                    </View>
                    <Feather name="chevron-right" size={20} color={colors.muted} />
                  </Card>
                </Pressable>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  oltCard: { flexDirection: "row", alignItems: "center", gap: space.md },
  oltIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandBg,
    alignItems: "center",
    justifyContent: "center",
  },
  oltNome: { fontSize: font.size.base, fontWeight: font.weight.bold as "700", color: colors.ink },
});
