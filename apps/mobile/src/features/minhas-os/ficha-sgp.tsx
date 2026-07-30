import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import type { OsFichaSgp } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, Muted, Pill, SectionLabel } from "@/components/ui";
import { rotuloSinal, toneSinal } from "@/features/provisionamento/sinal";
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

  async function copiar(rotulo: string, valor: string) {
    await Clipboard.setStringAsync(valor);
    setCopiado(rotulo);
    setTimeout(() => setCopiado(null), 1500);
  }

  // Enquanto carrega, nada: a tela ja tem conteudo e um esqueleto aqui so
  // piscaria. Mas depois de resolver, SEMPRE diz algo (ver abaixo).
  if (query.isPending) return null;

  if (query.isError) {
    return (
      <Card>
        <SectionLabel>Ficha do SGP</SectionLabel>
        <Muted>Não foi possível ler a ficha no SGP do provedor.</Muted>
      </Card>
    );
  }

  /*
   * O SGP nao devolveu NENHUMA das duas fontes (a OS e o cadastro do contrato).
   *
   * Antes isto dizia "esta OS nao existe mais no SGP" — uma afirmacao que o
   * dado nao sustenta. Vazio aqui pode ser OS encerrada, endpoint de OS nao
   * liberado na integracao do provedor, ou envelope diferente. Quem PROVA
   * ausencia e a deteccao de removidas do sync, que marca a OS como cancelada
   * e escreve isso no historico — e por isso que a mensagem aponta pra la em
   * vez de concluir por conta propria.
   */
  if (!f) {
    return (
      <Card>
        <SectionLabel>Ficha do SGP</SectionLabel>
        <Muted>O SGP não devolveu dados desta OS. Se ela foi removida por lá, o histórico registra.</Muted>
      </Card>
    );
  }

  const temCliente = f.clienteNome || f.clienteDocumento || f.clienteContato || f.clienteEmail || f.contratoStatus;
  const temPlano = f.plano || f.planoDownload || f.planoUpload;
  const temConexao =
    f.servicoOnline !== null || f.servicoIp || f.servicoMac || f.sinalRxDbm !== null || f.sinalTxDbm !== null || f.oltNome;
  const temPppoe = f.servicoLogin || f.servicoSenha;
  const temLocal = f.enderecoComplemento || f.enderecoPontoReferencia;
  const temEquipe = f.tecnicoResponsavel || f.tecnicosAuxiliares.length > 0 || f.setor;
  const temRegistro = f.servicoPrestado || f.observacao;

  /**
   * SGP respondeu, mas sem nada que interesse — acontece de verdade: contrato
   * inativo/cancelado nao tem servico ativo, logo nao tem plano nem PPPoE.
   *
   * Antes isto renderizava uma View vazia, e ausencia silenciosa ficava
   * indistinguivel de feature quebrada ("cade o PPPoE?"). Dizer o motivo custa
   * uma linha e responde sozinho.
   */
  if (!temCliente && !temPlano && !temConexao && !temPppoe && !temLocal && !temEquipe && !temRegistro) {
    return (
      <Card>
        <SectionLabel>Ficha do SGP</SectionLabel>
        <Muted>Sem cadastro, plano ou acesso PPPoE no SGP para esta OS — normal quando o contrato está inativo.</Muted>
      </Card>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      {/* Quem e o assinante — o tecnico confere na porta se e a pessoa do
          contrato antes de mexer em qualquer coisa. Documento e o desempate
          quando quem atende nao e o titular. Nome copiavel nao faz sentido;
          telefone sim, e onde o tecnico avisa que chegou. */}
      {temCliente ? (
        <Card style={{ gap: space.sm }}>
          <SectionLabel>Cliente</SectionLabel>
          {f.clienteNome ? <Text style={styles.destaque}>{f.clienteNome}</Text> : null}
          {f.contratoStatus ? <Muted>Contrato {f.contratoStatus}</Muted> : null}
          {f.clienteDocumento ? (
            <View>
              <Muted>CPF/CNPJ</Muted>
              <Text style={styles.mono}>{f.clienteDocumento}</Text>
            </View>
          ) : null}
          {f.clienteContato ? (
            <Pressable
              onPress={() => void copiar("contato", f.clienteContato!)}
              accessibilityRole="button"
              accessibilityLabel="Copiar telefone do cliente"
              style={styles.campo}
            >
              <View style={{ flex: 1 }}>
                <Muted>Telefone</Muted>
                <Text style={styles.mono} numberOfLines={1}>
                  {f.clienteContato}
                </Text>
              </View>
              <Feather name={copiado === "contato" ? "check" : "copy"} size={18} color={colors.brand} />
            </Pressable>
          ) : null}
          {f.clienteEmail ? <Muted>{f.clienteEmail}</Muted> : null}
        </Card>
      ) : null}

      {/* Plano: e a referencia pra saber se o que ele mediu esta certo. */}
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
        </Card>
      ) : null}

      {/* Conexao. O rotulo diz "ultimo lido" de proposito: o botao
          "Verificar conexao e sinal" desta mesma tela faz uma sonda AO VIVO,
          e dois numeros de dBm sem contexto viram duvida no campo ("qual vale?").
          Aqui e o que o SGP tem registrado; la e agora. */}
      {temConexao ? (
        <Card style={{ gap: space.sm }}>
          <SectionLabel>Conexão (último lido)</SectionLabel>
          <View style={styles.linha}>
            {f.servicoOnline !== null ? (
              <Pill label={f.servicoOnline ? "Online" : "Offline"} tone={f.servicoOnline ? "green" : "red"} />
            ) : null}
            {/* Cor aqui e semantica de sinal optico — a mesma faixa do
                provisionamento, nao uma cor decorativa. */}
            {f.sinalRxDbm !== null ? (
              <Pill label={`RX ${rotuloSinal(f.sinalRxDbm)}`} tone={toneSinal(f.sinalRxDbm)} />
            ) : null}
            {f.sinalTxDbm !== null ? <Muted>TX {rotuloSinal(f.sinalTxDbm)}</Muted> : null}
          </View>
          {f.servicoIp ? (
            <View>
              <Muted>IP</Muted>
              <Text style={styles.mono}>{f.servicoIp}</Text>
            </View>
          ) : null}
          {f.servicoMac ? (
            <View>
              <Muted>MAC</Muted>
              <Text style={styles.mono}>{f.servicoMac}</Text>
            </View>
          ) : null}
          {f.oltNome ? <Muted>OLT {f.oltNome}</Muted> : null}
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
