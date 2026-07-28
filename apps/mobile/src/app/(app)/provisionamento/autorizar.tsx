import { useState, type ReactNode } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { ProvisionarOnuInput } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Button, Field, Muted, Screen } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { fttxKeys, listarTemplates, useProvisionar } from "@/features/provisionamento/fttx";

/** Campo rotulado (label em caixa-alta + input). */
function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.rotulo}>{label}</Text>
      {children}
    </View>
  );
}

/**
 * Form de autorizar (provisionar) uma ONU na OLT. Chega com serial/slot/pon/tipo
 * pré-preenchidos da ONU escolhida; contrato/descrição podem vir de uma OS.
 * Autorizar é ESCRITA de rede (muda a ONU do cliente) — confirma antes de enviar.
 */
export default function AutorizarOnu() {
  const { token } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{
    provedorId: string;
    oltId: string;
    serial?: string;
    slot?: string;
    pon?: string;
    onutype?: string;
    contrato?: string;
    descricao?: string;
  }>();
  const { autorizar } = useProvisionar(params.provedorId, params.oltId);

  const [serial, setSerial] = useState(params.serial ?? "");
  const [slot, setSlot] = useState(params.slot ?? "");
  const [pon, setPon] = useState(params.pon ?? "");
  const [onutype, setOnutype] = useState(params.onutype ?? "");
  const [mode, setMode] = useState<1 | 2>(2); // 1=bridge, 2=pppoe (residencial)
  const [vlan, setVlan] = useState("");
  const [pppoeLogin, setPppoeLogin] = useState("");
  const [pppoeSenha, setPppoeSenha] = useState("");
  const [service, setService] = useState("");
  const [contrato, setContrato] = useState(params.contrato ?? "");
  const [descricao, setDescricao] = useState(params.descricao ?? "");
  const [ident, setIdent] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: fttxKeys.templates(params.provedorId, params.oltId),
    enabled: !!token && !!params.provedorId && !!params.oltId,
    queryFn: () => listarTemplates(params.provedorId, params.oltId, token),
  });

  function enviar() {
    if (!serial.trim() || !slot.trim() || !pon.trim()) {
      Alert.alert("Faltam dados", "Serial, slot e pon são obrigatórios.");
      return;
    }
    const dados: ProvisionarOnuInput = {
      serial: serial.trim(),
      slot: slot.trim(),
      pon: pon.trim(),
      // opcional: o SGP detecta o modelo pelo SN quando vazio.
      onutype: onutype.trim() || undefined,
      mode,
      vlan: vlan.trim() ? Number(vlan.trim()) : undefined,
      contrato: contrato.trim() || undefined,
      service: service.trim() || undefined,
      pppoeLogin: mode === 2 && pppoeLogin.trim() ? pppoeLogin.trim() : undefined,
      pppoeSenha: mode === 2 && pppoeSenha ? pppoeSenha : undefined,
      onutemplate: templateId ?? undefined,
      descricao: descricao.trim() || undefined,
      ident: ident.trim() || undefined,
    };

    Alert.alert(
      "Confirmar provisionamento",
      `Autorizar a ONU ${dados.serial} (slot ${dados.slot} / pon ${dados.pon}) como ${mode === 2 ? "PPPoE" : "Bridge"}${dados.contrato ? `, contrato ${dados.contrato}` : ""}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Autorizar",
          onPress: () =>
            autorizar.mutate(dados, {
              onSuccess: (r) => {
                Alert.alert("ONU autorizada", r.mensagem ?? "Provisionamento enviado ao SGP.", [
                  { text: "OK", onPress: () => router.back() },
                ]);
              },
              onError: (e) => Alert.alert("Erro", e instanceof Error ? e.message : "Falha ao autorizar"),
            }),
        },
      ],
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Autorizar ONU" }} />
      <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.md, paddingBottom: space.xxl }}>
        <Campo label="Serial (SN)">
          <Field value={serial} onChangeText={setSerial} autoCapitalize="characters" placeholder="Ex.: HWTC12345678" />
        </Campo>

        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Campo label="Slot">
              <Field value={slot} onChangeText={setSlot} keyboardType="number-pad" placeholder="0" />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo label="Pon">
              <Field value={pon} onChangeText={setPon} keyboardType="number-pad" placeholder="0" />
            </Campo>
          </View>
        </View>

        <Campo label="Tipo de ONU (opcional — o SGP detecta pelo SN)">
          <Field value={onutype} onChangeText={setOnutype} placeholder="Ex.: HG8310" />
        </Campo>

        <Campo label="Modo">
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {([
              [2, "PPPoE"],
              [1, "Bridge"],
            ] as const).map(([valor, rotulo]) => (
              <Pressable key={valor} onPress={() => setMode(valor)} style={[styles.seg, mode === valor && styles.segAtivo]}>
                <Text style={[styles.segTxt, mode === valor && styles.segTxtAtivo]}>{rotulo}</Text>
              </Pressable>
            ))}
          </View>
        </Campo>

        {mode === 2 ? (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Campo label="Login PPPoE">
                <Field value={pppoeLogin} onChangeText={setPppoeLogin} autoCapitalize="none" placeholder="login" />
              </Campo>
            </View>
            <View style={{ flex: 1 }}>
              <Campo label="Senha PPPoE">
                <Field value={pppoeSenha} onChangeText={setPppoeSenha} secureTextEntry placeholder="senha" />
              </Campo>
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Campo label="VLAN">
              <Field value={vlan} onChangeText={setVlan} keyboardType="number-pad" placeholder="opcional" />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo label="Contrato">
              <Field value={contrato} onChangeText={setContrato} keyboardType="number-pad" placeholder="opcional" />
            </Campo>
          </View>
        </View>

        <Campo label="Serviço (login/ID do cliente)">
          <Field value={service} onChangeText={setService} autoCapitalize="none" placeholder="opcional" />
        </Campo>

        <Campo label="Identificação (CTO)">
          <Field value={ident} onChangeText={setIdent} placeholder="Ex.: CTO-05 P3" />
        </Campo>

        <Campo label="Descrição">
          <Field value={descricao} onChangeText={setDescricao} placeholder="opcional" />
        </Campo>

        {templates.data && templates.data.length > 0 ? (
          <Campo label="Template (opcional)">
            <View style={styles.chips}>
              {templates.data.map((t) => {
                const ativo = t.id === templateId;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setTemplateId(ativo ? null : t.id)}
                    style={[styles.chip, ativo && styles.chipAtivo]}
                  >
                    <Text style={[styles.chipTxt, ativo && styles.chipTxtAtivo]}>{t.nome}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Campo>
        ) : null}

        <View style={{ marginTop: space.sm }}>
          <Button label={autorizar.isPending ? "Enviando…" : "Autorizar ONU"} loading={autorizar.isPending} onPress={enviar} />
        </View>
        <Muted>Autorizar provisiona a ONU no SGP do provedor — muda o serviço do cliente na OLT.</Muted>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rotulo: { fontSize: font.size.xs, fontWeight: "600", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.4 },
  seg: { flex: 1, paddingVertical: space.sm, alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.card },
  segAtivo: { backgroundColor: colors.brandBg, borderColor: colors.brand },
  segTxt: { fontSize: font.size.sm, fontWeight: "600", color: colors.ink2 },
  segTxtAtivo: { color: colors.brandInk },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.card },
  chipAtivo: { backgroundColor: colors.brandBg, borderColor: colors.brand },
  chipTxt: { fontSize: font.size.sm, fontWeight: "600", color: colors.ink2 },
  chipTxtAtivo: { color: colors.brandInk },
});
