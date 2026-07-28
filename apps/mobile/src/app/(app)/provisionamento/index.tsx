import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Olt, Provedor } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Card, Muted, Screen } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
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
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingVertical: space.md, paddingBottom: space.xxl }}>
        <View style={{ gap: space.sm }}>
          <Text style={styles.rotulo}>Provedor</Text>
          {provedores.isLoading ? (
            <ActivityIndicator color={colors.brand} />
          ) : provedores.data?.length === 0 ? (
            <Muted>Nenhum provedor disponível.</Muted>
          ) : (
            <View style={styles.chips}>
              {(provedores.data ?? []).map((p) => {
                const ativo = p.id === provedorId;
                return (
                  <Pressable key={p.id} onPress={() => setProvedorId(p.id)} style={[styles.chip, ativo && styles.chipAtivo]}>
                    <Text style={[styles.chipTxt, ativo && styles.chipTxtAtivo]}>{p.nome}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {!provedorId ? (
          <Muted>Selecione um provedor para ver as OLTs.</Muted>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text style={styles.rotulo}>OLTs</Text>
            {olts.isLoading ? (
              <ActivityIndicator color={colors.brand} />
            ) : olts.isError ? (
              <Muted>Não foi possível listar as OLTs deste provedor.</Muted>
            ) : (olts.data ?? []).length === 0 ? (
              <Muted>Nenhuma OLT neste provedor (o SGP pode não ter FTTX habilitado).</Muted>
            ) : (
              olts.data!.map((olt) => (
                <Pressable key={olt.id} onPress={() => abrirOlt(olt)}>
                  <Card>
                    <Text style={styles.oltNome}>{olt.nome}</Text>
                    {olt.fabricante ? <Muted>{olt.fabricante}</Muted> : null}
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
  rotulo: { fontSize: font.size.xs, fontWeight: "600", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  chipAtivo: { backgroundColor: colors.brandBg, borderColor: colors.brand },
  chipTxt: { fontSize: font.size.sm, fontWeight: "600", color: colors.ink2 },
  chipTxtAtivo: { color: colors.brandInk },
  oltNome: { fontSize: font.size.base, fontWeight: "600", color: colors.ink },
});
