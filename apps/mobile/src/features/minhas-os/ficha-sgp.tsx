import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import type { OsFichaSgp } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, Muted, Pill, SectionLabel } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";

/**
 * Ficha da OS lida ao vivo do SGP — o que o espelho local nao tem.
 *
 * Carrega DEPOIS da tela, sem travar nada: o detalhe da OS vem do espelho e
 * abre na hora. Se o SGP nao responder, este bloco simplesmente nao aparece e
 * o tecnico trabalha com o que ja tinha.
 *
 * `staleTime` espelha o TTL de 90s do cache do servidor — o mesmo contrato nao
 * e re-consultado antes disso de qualquer forma.
 */
export function FichaSgp({ osId }: { osId: string }) {
  const { token } = useAuth();
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["os-ficha", osId],
    enabled: !!token && !!osId,
    staleTime: 90_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: () => apiFetch<OsFichaSgp | null>(`/ordens-servico/${osId}/ficha-sgp`, { token }),
  });

  const f = query.data;
  if (!f) return null; // carregando, sem dados ou SGP fora — silencioso de proposito

  async function copiar(rotulo: string, valor: string) {
    await Clipboard.setStringAsync(valor);
    setCopiado(rotulo);
    setTimeout(() => setCopiado(null), 1500);
  }

  const temPlano = f.plano || f.planoDownload || f.planoUpload;
  const temPppoe = f.servicoLogin || f.servicoSenha;
  const temLocal = f.enderecoComplemento || f.enderecoPontoReferencia;
  const temEquipe = f.tecnicoResponsavel || f.tecnicosAuxiliares.length > 0 || f.setor;
  const temRegistro = f.servicoPrestado || f.observacao;

  return (
    <View style={{ gap: space.md }}>
      {/* Plano primeiro: e a referencia pra saber se o que ele mediu esta certo. */}
      {temPlano ? (
        <Card style={{ gap: space.sm }}>
          <SectionLabel>Plano contratado</SectionLabel>
          {f.plano ? <Text style={styles.destaque}>{f.plano}</Text> : null}
          {f.planoDownload || f.planoUpload ? (
            <View style={styles.linha}>
              {f.planoDownload ? <Pill label={`↓ ${f.planoDownload}`} tone="blue" /> : null}
              {f.planoUpload ? <Pill label={`↑ ${f.planoUpload}`} tone="blue" /> : null}
            </View>
          ) : null}
          {f.servicoOnline !== null || f.servicoIp ? (
            <View style={styles.linha}>
              {f.servicoOnline !== null ? (
                <Pill label={f.servicoOnline ? "Online" : "Offline"} tone={f.servicoOnline ? "green" : "red"} />
              ) : null}
              {f.servicoIp ? <Muted>{f.servicoIp}</Muted> : null}
            </View>
          ) : null}
          {f.servicoMac ? <Muted>MAC {f.servicoMac}</Muted> : null}
        </Card>
      ) : null}

      {/* PPPoE: o dado que mais economiza ligacao pro escritorio. Toque copia —
          digitar login e senha de PPPoE na mao, no sol, e onde nascem os erros. */}
      {temPppoe ? (
        <Card style={{ gap: space.sm }}>
          <SectionLabel>Acesso PPPoE</SectionLabel>
          {f.servicoLogin ? (
            <Pressable
              onPress={() => void copiar("login", f.servicoLogin!)}
              accessibilityRole="button"
              accessibilityLabel="Copiar login PPPoE"
              style={styles.campo}
            >
              <View style={{ flex: 1 }}>
                <Muted>Login</Muted>
                <Text style={styles.mono} numberOfLines={1}>
                  {f.servicoLogin}
                </Text>
              </View>
              <Feather name={copiado === "login" ? "check" : "copy"} size={18} color={colors.brand} />
            </Pressable>
          ) : null}
          {f.servicoSenha ? (
            <View style={styles.campo}>
              <View style={{ flex: 1 }}>
                <Muted>Senha</Muted>
                <Text style={styles.mono} numberOfLines={1}>
                  {senhaVisivel ? f.servicoSenha : "•".repeat(Math.min(f.servicoSenha.length, 12))}
                </Text>
              </View>
              <Pressable
                onPress={() => setSenhaVisivel((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={senhaVisivel ? "Ocultar senha" : "Mostrar senha"}
              >
                <Feather name={senhaVisivel ? "eye-off" : "eye"} size={18} color={colors.ink2} />
              </Pressable>
              <Pressable
                onPress={() => void copiar("senha", f.servicoSenha!)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Copiar senha PPPoE"
              >
                <Feather name={copiado === "senha" ? "check" : "copy"} size={18} color={colors.brand} />
              </Pressable>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* Como achar a casa. Nenhum dos dois existe no espelho local. */}
      {temLocal ? (
        <Card style={{ gap: 4 }}>
          <SectionLabel>Como chegar</SectionLabel>
          {f.enderecoComplemento ? <Text style={styles.texto}>{f.enderecoComplemento}</Text> : null}
          {f.enderecoPontoReferencia ? (
            <View style={styles.refRow}>
              <Feather name="map-pin" size={14} color={colors.ink2} style={{ marginTop: 3 }} />
              <Text style={[styles.texto, { flex: 1 }]}>{f.enderecoPontoReferencia}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {temRegistro ? (
        <Card style={{ gap: space.sm }}>
          <SectionLabel>Registrado na OS</SectionLabel>
          {f.servicoPrestado ? (
            <View>
              <Muted>Serviço prestado</Muted>
              <Text style={styles.texto}>{f.servicoPrestado}</Text>
            </View>
          ) : null}
          {f.observacao ? (
            <View>
              <Muted>Observação</Muted>
              <Text style={styles.texto}>{f.observacao}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {temEquipe ? (
        <Card style={{ gap: 4 }}>
          <SectionLabel>Equipe e setor</SectionLabel>
          {f.tecnicoResponsavel ? <Text style={styles.texto}>Responsável: {f.tecnicoResponsavel}</Text> : null}
          {f.tecnicosAuxiliares.length > 0 ? <Muted>Apoio: {f.tecnicosAuxiliares.join(", ")}</Muted> : null}
          {f.setor ? <Muted>Setor: {f.setor}</Muted> : null}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  destaque: { fontSize: font.size.lg, fontWeight: font.weight.bold as "700", color: colors.ink },
  texto: { fontSize: font.size.base, color: colors.ink, lineHeight: 21 },
  linha: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  refRow: { flexDirection: "row", gap: space.xs },
  // minHeight 44: sao alvos de toque (copiar/revelar) usados de luva, no sol.
  campo: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  mono: { fontSize: font.size.base, color: colors.ink, fontWeight: font.weight.medium as "600", letterSpacing: 0.3 },
});
