import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { OS_STATUS_LABEL, OsStatus, temDestino, type OrdemServico } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { useModuloHabilitado } from "@/lib/config";
import { apiFetch } from "@/lib/api";
import { Button, Card, Field, Muted, Pill, Screen, SectionLabel, Title, type PillTone } from "@/components/ui";
import { colors, font, space } from "@/theme/tokens";
import { useAcoesOs } from "@/features/minhas-os/acoes";
import { GaleriaEvidencias } from "@/features/evidencias/galeria";
import { abrirNoWaze } from "@/features/minhas-os/navegacao";
import { AcaoContratoStatus } from "@/features/minhas-os/acao-contrato-status";
import { ConexaoStatus } from "@/features/minhas-os/conexao-status";
import { FichaSgpComoChegar, FichaSgpConexao, FichaSgpContrato, useFichaSgp } from "@/features/minhas-os/ficha-sgp";
import { useCriarConversa } from "@/features/chat/hooks";

function soDigitos(tel: string): string {
  return tel.replace(/\D/g, "");
}

/** O status vira cor: o tecnico enxerga o estado da OS num relance. */
function tomStatus(s: OsStatus): PillTone {
  switch (s) {
    case OsStatus.CONCLUIDA:
      return "green";
    case OsStatus.CANCELADA:
      return "red";
    case OsStatus.EM_EXECUCAO:
      return "brand";
    case OsStatus.EM_DESLOCAMENTO:
    case OsStatus.PENDENTE:
      return "amber";
    default:
      return "blue"; // ABERTA
  }
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
  const { token, usuario } = useAuth();
  const router = useRouter();
  const temProvisionamento = useModuloHabilitado("provisionamento");
  const temChat = useModuloHabilitado("chat");
  const temEvidencias = useModuloHabilitado("evidencias");
  const [nota, setNota] = useState("");
  const { marcarACaminho, mudarStatus, anotar, mudarContratoStatus } = useAcoesOs(id);
  const { garantirConversaDeOs } = useCriarConversa();

  const query = useQuery({
    queryKey: ["os", id],
    enabled: !!token && !!id,
    queryFn: () => apiFetch<OrdemServico>(`/ordens-servico/${id}`, { token }),
  });
  const os = query.data;

  // Uma consulta por tela, consumida por TRES pedacos em pontos diferentes do
  // scroll (ponto de referencia no card de endereco, conexao e cadastro mais
  // abaixo). Ver a nota em useFichaSgp.
  const { ficha, carregando: carregandoFicha, erro: erroFicha } = useFichaSgp(id ?? "");

  const acao = os ? proximaAcao(os.status) : null;
  const executando = marcarACaminho.isPending || mudarStatus.isPending;

  function rodarAcao() {
    if (!acao) return;
    if (acao.alvo === "acaminho") marcarACaminho.mutate();
    else mudarStatus.mutate(acao.alvo);
  }

  function abrirMapa() {
    if (os) abrirNoWaze(os.endereco);
  }

  const endereco = os?.endereco?.logradouro
    ? `${os.endereco.logradouro}${os.endereco.numero ? `, ${os.endereco.numero}` : ""}${os.endereco.bairro ? ` — ${os.endereco.bairro}` : ""}`
    : os?.pop
      ? `POP: ${os.pop}`
      : "Endereço não informado";

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: os ? `OS #${os.sgpOsId}` : "OS" }} />
      {query.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} />
      ) : !os ? (
        <Muted>Não foi possível carregar a OS.</Muted>
      ) : (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: space.md, paddingVertical: space.md, paddingBottom: acao ? 96 : space.xxl }}
          >
            {/* Cabecalho: categoria + status (cor = estado) + cliente */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
                <Muted>{os.categoria?.nome ?? "Não classificado"}</Muted>
                <Pill label={OS_STATUS_LABEL[os.status]} tone={tomStatus(os.status)} />
              </View>
              <Title>{os.clienteNome ?? "Cliente não identificado"}</Title>
            </View>

            {/*
              Ordem da tela = ordem do trabalho em campo: por que estou indo →
              onde é → avisar que estou indo → (na porta) a ficha técnica →
              registrar.

              O que estava errado antes: a ficha do SGP ficava logo abaixo do
              endereço e, depois de ganhar cadastro e sinal, passou a ocupar uns
              900px — empurrando pra baixo justamente a DESCRIÇÃO do problema e
              os botões de contato. O técnico rolava dois telefones de dados de
              referência pra descobrir por que tinha sido chamado.
            */}

            {/* Descricao da OS: o motivo da visita, antes de qualquer outra coisa. */}
            {os.conteudo ? (
              <Card>
                <Text style={styles.conteudo}>{os.conteudo}</Text>
              </Card>
            ) : null}

            {/* Endereco + como chegar + mapa, tudo junto: complemento e ponto de
                referência vinham numa seção separada no fim da ficha, a ~700px
                daqui — quem lia o endereço não sabia que existiam. */}
            <Card style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Feather name="map-pin" size={18} color={colors.brand} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text style={styles.addr}>{endereco}</Text>
                  {os.endereco?.cidade ? <Muted>{os.endereco.cidade}</Muted> : null}
                  <FichaSgpComoChegar ficha={ficha} />
                </View>
              </View>
              {temDestino(os.endereco) ? (
                <Button
                  label="Abrir no Waze"
                  variant="secondary"
                  size="sm"
                  icon={<Feather name="navigation" size={14} color={colors.brandInk} />}
                  onPress={abrirMapa}
                />
              ) : null}
            </Card>

            {/* Contato: avisar que está a caminho vem ANTES da ficha técnica —
                é o que se faz saindo, não na porta. */}
            {os.telefone ? (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Ligar"
                    variant="secondary"
                    icon={<Feather name="phone" size={16} color={colors.brandInk} />}
                    onPress={() => Linking.openURL(`tel:${soDigitos(os.telefone!)}`)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="WhatsApp"
                    variant="secondary"
                    icon={<Feather name="message-circle" size={16} color={colors.brandInk} />}
                    onPress={() => Linking.openURL(`https://wa.me/55${soDigitos(os.telefone!)}`)}
                  />
                </View>
              </View>
            ) : null}

            {/* Sonda AO VIVO, logo acima do "último lido" da ficha: os dois
                valores de dBm ficam vizinhos, cada um rotulado. */}
            <ConexaoStatus provedorId={os.provedorId} contratoId={os.contratoId} />

            {/* Referência técnica, dobrada: importa na porta do cliente, com a
                ONU na mão. O cabeçalho mostra sinal e plano sem precisar abrir. */}
            <FichaSgpConexao ficha={ficha} carregando={carregandoFicha} erro={erroFicha} />
            <FichaSgpContrato ficha={ficha} carregando={carregandoFicha} erro={erroFicha} />

            {/*
              Reativar contrato — a acao que faltava pra quem esta na porta do
              cliente. So aparece quando o papel de fato alcanca: `alvosPermitidos`
              e a MESMA funcao que o servidor usa pra recusar, entao a tela nunca
              oferece o que a API nega. Pro tecnico isso significa exatamente um
              caso: contrato Inativo.
            */}
            <AcaoContratoStatus
              os={os}
              role={usuario?.role}
              executando={mudarContratoStatus.isPending}
              onAplicar={(codigo) => mudarContratoStatus.mutate(codigo)}
            />

            {temEvidencias && <GaleriaEvidencias osId={id} />}

            {/* Anotacao */}
            <View style={{ gap: space.sm }}>
              <SectionLabel>Anotação</SectionLabel>
              <Field value={nota} onChangeText={setNota} placeholder="Ex.: ONU instalada, sinal OK." multiline style={{ minHeight: 64 }} />
              <Button
                label={anotar.isPending ? "Enviando…" : "Adicionar anotação"}
                variant="ghost"
                icon={<Feather name="edit-3" size={16} color={colors.ink} />}
                loading={anotar.isPending}
                onPress={() => {
                  if (!nota.trim()) return;
                  anotar.mutate(nota.trim(), { onSuccess: () => setNota("") });
                }}
              />
            </View>

            {/* Navegacao secundaria */}
            {temProvisionamento ? (
              <Button
                label="Provisionar ONU"
                variant="ghost"
                icon={<Feather name="wifi" size={16} color={colors.ink} />}
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
            ) : null}

            {temChat ? (
              <Button
                label={garantirConversaDeOs.isPending ? "Abrindo…" : "Chat da OS"}
                variant="ghost"
                icon={<Feather name="message-square" size={16} color={colors.ink} />}
                loading={garantirConversaDeOs.isPending}
                onPress={() => garantirConversaDeOs.mutate(os.id, { onSuccess: (conversa) => router.push(`/chat/${conversa.id}`) })}
              />
            ) : null}
          </ScrollView>

          {/* CTA primaria fixa: a proxima acao do fluxo, sempre no alcance do polegar */}
          {acao ? (
            <View style={styles.footer}>
              <Button label={executando ? "Enviando…" : acao.label} loading={executando} onPress={rodarAcao} fullWidth />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  addr: { fontSize: font.size.base, color: colors.ink, lineHeight: 21 },
  conteudo: { fontSize: font.size.base, color: colors.ink2, lineHeight: 22 },
  // Barra fixa edge-to-edge: cancela o padding lateral do Screen pra encostar nas
  // bordas e re-aplica o proprio, como uma barra de acao de verdade.
  footer: {
    marginHorizontal: -space.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
  },
});
