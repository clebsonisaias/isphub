import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CANAL_WHATSAPP_LABEL, CanalWhatsapp, type TemplateWhatsappDTO } from "@isphub/shared";
import { ApiError } from "@/lib/api";
import { Button, Field, Muted, Screen } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { useIniciarConversaCliente, useTemplatesWhatsapp } from "@/features/cliente-chat/hooks";
import { renderizarTemplate, somenteDigitos, telefoneValido, templateCompleto, varsDoTemplate } from "@/features/cliente-chat/format";

function mensagemErro(erro: unknown, padrao: string): string {
  return erro instanceof ApiError ? erro.message : padrao;
}

function CartaoTemplate({ template, onPress }: { template: TemplateWhatsappDTO; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.cartao, pressed && { opacity: 0.85 }]}>
      <View style={styles.cartaoTopo}>
        <Text style={styles.cartaoNome}>{template.nome}</Text>
        <View style={styles.pill}>
          <Text style={styles.pillTexto}>{template.categoria}</Text>
        </View>
      </View>
      <Text style={styles.cartaoCorpo} numberOfLines={2}>
        {template.corpo}
      </Text>
      <Muted style={{ fontSize: font.size.xs }}>
        {template.idioma}
        {template.variaveis.length === 0
          ? " · sem variáveis"
          : ` · ${template.variaveis.length} ${template.variaveis.length > 1 ? "variáveis" : "variável"}`}
      </Muted>
    </Pressable>
  );
}

/**
 * Iniciar conversa com um cliente que ainda nao escreveu. Fora da janela de 24h
 * a Meta so aceita modelo aprovado (HSM) — dai a tela ser "escolher modelo e
 * preencher", e nao um campo de texto livre. O catalogo vem ao vivo da Meta
 * pelo servidor: modelo reprovado la some daqui sozinho.
 */
export default function NovaConversaCliente() {
  const router = useRouter();
  const templatesQuery = useTemplatesWhatsapp();
  const iniciar = useIniciarConversaCliente();
  const [nomeTemplate, setNomeTemplate] = useState<string | null>(null);
  const [telefone, setTelefone] = useState("");
  const [nomeContato, setNomeContato] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});

  const template = (templatesQuery.data ?? []).find((t) => t.nome === nomeTemplate) ?? null;

  function escolherTemplate(escolhido: TemplateWhatsappDTO) {
    setNomeTemplate(escolhido.nome);
    setVars({}); // os valores do modelo anterior nao correspondem as variaveis deste
  }

  function handleIniciar() {
    if (!template) return;
    const digitos = somenteDigitos(telefone);
    if (!telefoneValido(digitos)) {
      Alert.alert("Telefone inválido", "Informe DDD + número do WhatsApp do cliente.");
      return;
    }
    if (!templateCompleto(template, vars)) {
      Alert.alert("Faltam variáveis", "Preencha todas as variáveis do modelo — a Meta recusa o envio com parâmetro vazio.");
      return;
    }
    iniciar.mutate(
      {
        telefone: digitos,
        nomeContato: nomeContato.trim() || undefined,
        canal: CanalWhatsapp.META,
        templateNome: template.nome,
        vars: varsDoTemplate(template, vars),
      },
      {
        // replace: voltar da conversa cai na lista, nao no formulario ja enviado.
        onSuccess: (conversa) => router.replace(`/chat-clientes/${conversa.id}`),
        onError: (erro) => Alert.alert("Não foi possível iniciar", mensagemErro(erro, "Falha ao falar com o servidor.")),
      },
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: "Nova conversa" }} />

        {!template ? (
          <View style={{ flex: 1 }}>
            <Muted style={{ paddingVertical: space.md }}>
              O WhatsApp só permite falar primeiro com o cliente por um modelo aprovado pela Meta. Escolha o modelo:
            </Muted>
            {templatesQuery.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: space.lg }} />
            ) : (
              <FlatList
                data={templatesQuery.data ?? []}
                keyExtractor={(t) => t.nome}
                contentContainerStyle={{ paddingBottom: space.xl, gap: space.sm }}
                ListEmptyComponent={
                  <Muted style={{ marginTop: space.md }}>
                    {templatesQuery.isError
                      ? mensagemErro(templatesQuery.error, "Não foi possível carregar os modelos.")
                      : "Nenhum modelo aprovado disponível no canal WhatsApp Oficial."}
                  </Muted>
                }
                renderItem={({ item }) => <CartaoTemplate template={item} onPress={() => escolherTemplate(item)} />}
              />
            )}
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: space.md, gap: space.md }} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => setNomeTemplate(null)} hitSlop={8}>
              <Text style={styles.trocar}>← {template.nome} · trocar modelo</Text>
            </Pressable>

            <View style={{ gap: space.sm }}>
              <Muted>Telefone do cliente (com DDD)</Muted>
              <Field value={telefone} onChangeText={setTelefone} placeholder="11999998888" keyboardType="phone-pad" />
            </View>

            <View style={{ gap: space.sm }}>
              <Muted>Nome do contato (opcional)</Muted>
              <Field value={nomeContato} onChangeText={setNomeContato} placeholder="Como aparece na lista" />
            </View>

            {template.variaveis.map((indice) => (
              <View key={indice} style={{ gap: space.sm }}>
                <Muted>{`Variável {{${indice}}}`}</Muted>
                <Field
                  value={vars[String(indice)] ?? ""}
                  onChangeText={(valor) => setVars((atual) => ({ ...atual, [String(indice)]: valor }))}
                  placeholder={`Valor de {{${indice}}}`}
                />
              </View>
            ))}

            <View style={styles.preview}>
              <Text style={styles.previewTitulo}>Prévia da mensagem</Text>
              <Text style={styles.previewTexto}>{renderizarTemplate(template, vars)}</Text>
            </View>

            <Button label="Enviar e abrir conversa" onPress={handleIniciar} loading={iniciar.isPending} />
            <Muted style={{ fontSize: font.size.xs }}>
              Enviado pelo canal {CANAL_WHATSAPP_LABEL[CanalWhatsapp.META]} — modelo só existe no WhatsApp oficial.
            </Muted>
          </ScrollView>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  cartao: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.md, gap: 4 },
  cartaoTopo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  cartaoNome: { flex: 1, fontSize: font.size.base, fontWeight: font.weight.medium as "600", color: colors.ink },
  cartaoCorpo: { fontSize: font.size.sm, color: colors.ink2 },
  pill: { backgroundColor: colors.brandBg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  pillTexto: { fontSize: font.size.xs, color: colors.brandInk },
  trocar: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.brand },
  preview: { backgroundColor: colors.brandBg, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  previewTitulo: { fontSize: font.size.xs, fontWeight: font.weight.medium as "600", color: colors.brandInk },
  previewTexto: { fontSize: font.size.base, color: colors.ink },
});
