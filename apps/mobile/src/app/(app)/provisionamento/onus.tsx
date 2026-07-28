import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { OnuAutorizada, OnuNaoAutorizada } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Button, Field, Muted, Screen } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { fttxKeys, listarOnus, useProvisionar, type OnuStatus } from "@/features/provisionamento/fttx";
import { corSinal, rotuloSinal } from "@/features/provisionamento/sinal";

/**
 * ONUs de uma OLT: aba "Não autorizadas" (as que apareceram na rede e esperam
 * provisionamento) e aba "Autorizadas" (com cliente/contrato, buscavel). A aba
 * não-autorizadas re-busca sozinha a cada 20s pra a ONU recém-ligada aparecer.
 */
export default function OnusOlt() {
  const { token } = useAuth();
  const router = useRouter();
  const { provedorId, oltId, oltNome, contrato, descricao } = useLocalSearchParams<{
    provedorId: string;
    oltId: string;
    oltNome?: string;
    contrato?: string;
    descricao?: string;
  }>();
  const [aba, setAba] = useState<OnuStatus>("nao-autorizadas");
  const [busca, setBusca] = useState(contrato ?? "");
  const [buscaAtiva, setBuscaAtiva] = useState(contrato ?? "");
  const { desautorizar } = useProvisionar(provedorId, oltId);

  const query = useQuery({
    queryKey: fttxKeys.onus(provedorId, oltId, aba, aba === "autorizadas" ? buscaAtiva : undefined),
    enabled: !!token && !!provedorId && !!oltId,
    queryFn: () => listarOnus(provedorId, oltId, aba, token, aba === "autorizadas" ? buscaAtiva || undefined : undefined),
    refetchInterval: aba === "nao-autorizadas" ? 20000 : false,
  });

  function autorizar(onu: OnuNaoAutorizada) {
    router.push({
      pathname: "/provisionamento/autorizar",
      params: {
        provedorId,
        oltId,
        serial: onu.serial,
        slot: onu.slot ?? "",
        pon: onu.pon ?? "",
        onutype: onu.tipo ?? "",
        ...(contrato ? { contrato } : {}),
        ...(descricao ? { descricao } : {}),
      },
    });
  }

  function confirmarDesautorizar(onu: OnuAutorizada) {
    Alert.alert(
      "Desautorizar ONU",
      `Remover a ONU ${onu.serial}${onu.clienteNome ? ` (${onu.clienteNome})` : ""}? Isso derruba o serviço do cliente.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Desautorizar",
          style: "destructive",
          onPress: () =>
            desautorizar.mutate(onu.id, {
              onSuccess: () => Alert.alert("Pronto", "ONU desautorizada."),
              onError: (e) => Alert.alert("Erro", e instanceof Error ? e.message : "Falha ao desautorizar"),
            }),
        },
      ],
    );
  }

  const dados = query.data ?? [];

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <Stack.Screen options={{ headerShown: true, title: oltNome ?? "OLT" }} />

      <View style={styles.tabs}>
        {(["nao-autorizadas", "autorizadas"] as const).map((t) => (
          <Pressable key={t} onPress={() => setAba(t)} style={[styles.tab, aba === t && styles.tabAtiva]}>
            <Text style={[styles.tabTxt, aba === t && styles.tabTxtAtiva]}>
              {t === "nao-autorizadas" ? "Não autorizadas" : "Autorizadas"}
            </Text>
          </Pressable>
        ))}
      </View>

      {aba === "autorizadas" ? (
        <View style={styles.buscaLinha}>
          <View style={{ flex: 1 }}>
            <Field
              value={busca}
              onChangeText={setBusca}
              placeholder="Buscar por contrato ou CPF/CNPJ"
              autoCapitalize="none"
              onSubmitEditing={() => setBuscaAtiva(busca.trim())}
              returnKeyType="search"
            />
          </View>
          <Button label="Buscar" variant="ghost" onPress={() => setBuscaAtiva(busca.trim())} />
        </View>
      ) : null}

      {query.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : aba === "nao-autorizadas" ? (
        <FlatList
          data={dados as OnuNaoAutorizada[]}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.lista}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} tintColor={colors.brand} />}
          ListEmptyComponent={
            <Muted>{query.isError ? "Não foi possível listar as ONUs." : "Nenhuma ONU aguardando autorização."}</Muted>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.serial}>{item.serial}</Text>
                <Muted>
                  {[item.slot != null ? `slot ${item.slot}` : null, item.pon != null ? `pon ${item.pon}` : null, item.tipo]
                    .filter(Boolean)
                    .join(" · ") || "sem detalhes"}
                </Muted>
                <Text style={[styles.sinal, { color: corSinal(item.sinalRxDbm) }]}>{rotuloSinal(item.sinalRxDbm)}</Text>
              </View>
              <Button label="Autorizar" onPress={() => autorizar(item)} />
            </View>
          )}
        />
      ) : (
        <FlatList
          data={dados as OnuAutorizada[]}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.lista}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} tintColor={colors.brand} />}
          ListEmptyComponent={
            <Muted>{query.isError ? "Não foi possível listar as ONUs." : "Nenhuma ONU autorizada encontrada."}</Muted>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.serial}>{item.serial}</Text>
                <Muted>
                  {[item.clienteNome, item.contrato ? `contrato ${item.contrato}` : null].filter(Boolean).join(" · ") ||
                    "sem cliente"}
                </Muted>
                <Text style={[styles.sinal, { color: corSinal(item.sinalRxDbm) }]}>{rotuloSinal(item.sinalRxDbm)}</Text>
              </View>
              <Button label="Remover" variant="ghost" onPress={() => confirmarDesautorizar(item)} />
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md },
  tab: { flex: 1, paddingVertical: space.sm, alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2 },
  tabAtiva: { backgroundColor: colors.brandBg, borderColor: colors.brand },
  tabTxt: { fontSize: font.size.sm, fontWeight: "600", color: colors.ink2 },
  tabTxtAtiva: { color: colors.brandInk },
  buscaLinha: { flexDirection: "row", gap: space.sm, alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.md },
  lista: { gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, paddingBottom: space.xxl },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
  },
  serial: { fontSize: font.size.base, fontWeight: "700", color: colors.ink, letterSpacing: 0.3 },
  sinal: { fontSize: font.size.sm, fontWeight: "600", marginTop: 2 },
});
