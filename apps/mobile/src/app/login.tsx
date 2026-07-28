import { useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Button, Field, Screen } from "@/components/ui";
import { colors, font, space } from "@/theme/tokens";

export default function Login() {
  const { token, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (token) return <Redirect href="/minhas-os" />;

  async function entrar() {
    setErro(null);
    setEnviando(true);
    try {
      await login(email.trim(), senha);
      router.replace("/minhas-os");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Falha ao conectar com o servidor");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center" }}>
        <View style={{ gap: space.md }}>
          <View style={{ marginBottom: space.lg }}>
            <Text style={{ fontSize: 26, fontWeight: "700", color: colors.ink, letterSpacing: -0.5 }}>
              <Text style={{ color: colors.brand }}>ISP</Text>hub
            </Text>
            <Text style={{ fontSize: font.size.base, color: colors.ink2, marginTop: 2 }}>Área do técnico</Text>
          </View>

          <Text style={styleLabel}>E-mail</Text>
          <Field
            value={email}
            onChangeText={setEmail}
            placeholder="voce@provedor.com.br"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="username"
          />

          <Text style={styleLabel}>Senha</Text>
          <Field value={senha} onChangeText={setSenha} placeholder="••••••••" secureTextEntry autoComplete="current-password" />

          {erro && (
            <Text style={{ color: colors.slaRed, fontSize: font.size.sm, marginTop: space.xs }}>{erro}</Text>
          )}

          <View style={{ marginTop: space.md }}>
            <Button label={enviando ? "Entrando..." : "Entrar"} onPress={entrar} loading={enviando} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styleLabel = {
  fontSize: font.size.xs,
  fontWeight: "600" as const,
  color: colors.ink2,
  textTransform: "uppercase" as const,
  letterSpacing: 0.4,
};
