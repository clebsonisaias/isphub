import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Linking, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { OS_STATUS_LABEL, OsStatus, type OrdemServico } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { useModulos } from "@/lib/config";
import { apiFetch } from "@/lib/api";
import { Button, Card, Field, Muted, Screen, Title } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { useAcoesOs } from "@/features/minhas-os/acoes";
import { useCriarConversa } from "@/features/chat/hooks";

function soDigitos(tel: string): string {
  return tel.replace(/\D/g, "");
}

/** Proxima acao natural pelo status atual (o fluxo do tecnico em campo). */
function proximaAcao(status: OsStatus): { label: string; alvo: OsStatus | "acaminho" } | null {
  switch (status) {
    case OsStatus.ABERTA:
    case OsStatus.PENDENTE:
      return { label: "Marcar a caminho", alvo: "acaminho" };
    case OsStatus.EM_DESLOCAMENTO:
      return { label: "Iniciar execução", alvo: OsStatus.EM_EXECUCAO };
    case OsStatus.EM_EXECUCAO:
      return { label: "Concluir OS", alvo: OsStatus.CONCLUIDA };
    default:
      return null;
  }
}

export default function DetalheOs() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const router = useRouter();
  const { modulos } = useModulos();
  const temProvisionamento = modulos.some((m) => m.id === "provisionamento");
  const temChat = modulos.some((m) => m.id === "chat");
  const [nota, setNota] = useState("");
  const { marcarACaminho, mudarStatus, anotar } = useAcoesOs(id);
  const { garantirConversaDeOs } = useCriarConversa();

  const query = useQuery({
    queryKey: ["os", id],
    enabled: !!token && !!id,
    queryFn: () => apiFetch<OrdemServico>(`/ordens-servico/${id}`, { token }),
  });
  const os = query.data;

  const acao = os ? proximaAcao(os.status) : null;
  const executando = marcarACaminho.isPending || mudarStatus.isPending;

  function rodarAcao() {
    if (!acao) return;
    if (acao.alvo === "acaminho") marcarACaminho.mutate();
    else mudarStatus.mutate(acao.alvo);
  }

  function abrirMapa() {
    if (!os) return;
    const url =
      os.endereco?.lat != null && os.endereco?.lng != null
        ? `https://www.google.com/maps/search/?api=1&query=${os.endereco?.lat},${os.endereco?.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            [os.endereco?.logradouro, os.endereco?.numero, os.endereco?.cidade].filter(Boolean).join(" "),
          )}`;
    Linking.openURL(url);
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: os ? `OS #${os.sgpOsId}` : "OS" }} />
      {query.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : !os ? (
        <Muted>Não foi possível carregar a OS.</Muted>
      ) : (
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.md, paddingBottom: space.xxl }}>
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Muted>{os.categoria?.nome ?? "Não classificado"}</Muted>
              <View style={{ backgroundColor: "#EEF1F6", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: font.size.xs, fontWeight: "600", color: colors.ink2 }}>
                  {OS_STATUS_LABEL[os.status]}
                </Text>
              </View>
            </View>
            <Title>{os.clienteNome ?? "Cliente não identificado"}</Title>
          </View>

          <Card>
            <Text style={{ fontSize: font.size.base, color: colors.ink }}>
              {os.endereco?.logradouro
                ? `${os.endereco?.logradouro}${os.endereco?.numero ? `, ${os.endereco?.numero}` : ""}${os.endereco?.bairro ? ` — ${os.endereco?.bairro}` : ""}`
                : os.pop
                  ? `POP: ${os.pop}`
                  : "Endereço não informado"}
            </Text>
            {os.endereco?.cidade ? <Muted>{os.endereco?.cidade}</Muted> : null}
            <View style={{ marginTop: space.sm }}>
              <Button label="Abrir no mapa" variant="ghost" onPress={abrirMapa} />
            </View>
          </Card>

          {os.telefone ? (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="Ligar" variant="ghost" onPress={() => Linking.openURL(`tel:${soDigitos(os.telefone!)}`)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="WhatsApp"
                  variant="ghost"
                  onPress={() => Linking.openURL(`https://wa.me/55${soDigitos(os.telefone!)}`)}
                />
              </View>
            </View>
          ) : null}

          {os.conteudo ? (
            <Card>
              <Text style={{ fontSize: font.size.base, color: colors.ink2, lineHeight: 22 }}>{os.conteudo}</Text>
            </Card>
          ) : null}

          <View style={{ gap: space.sm }}>
            <Text style={{ fontSize: font.size.xs, fontWeight: "600", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Anotação
            </Text>
            <Field value={nota} onChangeText={setNota} placeholder="Ex.: ONU instalada, sinal OK." multiline style={{ minHeight: 64 }} />
            <Button
              label={anotar.isPending ? "Enviando…" : "Adicionar anotação"}
              variant="ghost"
              loading={anotar.isPending}
              onPress={() => {
                if (!nota.trim()) return;
                anotar.mutate(nota.trim(), { onSuccess: () => setNota("") });
              }}
            />
          </View>

          {acao ? (
            <View style={{ marginTop: space.sm }}>
              <Button label={executando ? "Enviando…" : acao.label} loading={executando} onPress={rodarAcao} />
            </View>
          ) : null}

          {temProvisionamento ? (
            <View>
              <Button
                label="Provisionar ONU"
                variant="ghost"
                onPress={() =>
                  router.push({
                    pathname: "/provisionamento",
                    params: {
                      provedorId: os.provedorId,
                      ...(os.contratoId ? { contrato: os.contratoId } : {}),
                      ...(os.clienteNome ? { descricao: os.clienteNome } : {}),
                    },
                  })
                }
              />
            </View>
          ) : null}

          {temChat ? (
            <View>
              <Button
                label={garantirConversaDeOs.isPending ? "Abrindo…" : "Chat da OS"}
                variant="ghost"
                loading={garantirConversaDeOs.isPending}
                onPress={() => garantirConversaDeOs.mutate(os.id, { onSuccess: (conversa) => router.push(`/chat/${conversa.id}`) })}
              />
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
