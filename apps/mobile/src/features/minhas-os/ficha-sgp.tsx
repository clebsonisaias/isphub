import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import type { OsFichaSgp } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, Dobravel, Muted, Pill, SectionLabel } from "@/components/ui";
import { rotuloSinal, toneSinal } from "@/features/provisionamento/sinal";
import { colors, font, radius, space } from "@/theme/tokens";

/**
 * Ficha da OS lida ao vivo do SGP — o que o espelho local nao tem.
 *
 * Uma consulta por tela, consumida por tres pedacos que moram em lugares
 * diferentes do detalhe da OS: o ponto de referencia entra no card de endereco
 * (la em cima, junto do "Abrir no mapa"), e conexao e cadastro viram secoes
 * dobraveis mais abaixo. Um componente com fetch proprio pra cada pedaco faria
 * tres consultas ao ERP do provedor pela mesma coisa.
 *
 * `staleTime` espelha o TTL de 90s do cache do servidor — o mesmo contrato nao
 * e re-consultado antes disso de qualquer forma.
 */
export function useFichaSgp(osId: string) {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: ["os-ficha", osId],
    enabled: !!token && !!osId,
    staleTime: 90_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: () => apiFetch<OsFichaSgp | null>(`/ordens-servico/${osId}/ficha-sgp`, { token }),
  });
  return { ficha: query.data ?? null, carregando: query.isPending, erro: query.isError };
}

type Props = { ficha: OsFichaSgp | null; carregando: boolean; erro: boolean };

/**
 * Mensagem quando nao ha o que renderizar; `null` quando ha ficha.
 *
 * Enquanto carrega devolve `null` de proposito: a tela ja tem conteudo e um
 * esqueleto aqui so piscaria. Depois de resolver, SEMPRE diz algo.
 */
function textoDoVazio({ ficha, carregando, erro }: Props): string | null {
  if (carregando) return null;
  if (erro) return "Não foi possível ler a ficha no SGP do provedor.";
  /*
   * O SGP nao devolveu NENHUMA das duas fontes (a OS e o cadastro do contrato).
   *
   * Antes isto dizia "esta OS nao existe mais no SGP" — uma afirmacao que o
   * dado nao sustenta. Vazio aqui pode ser OS encerrada, endpoint de OS nao
   * liberado na integracao do provedor, ou envelope diferente. Quem PROVA
   * ausencia e a deteccao de removidas do sync, que marca a OS como cancelada
   * e escreve isso no historico.
   */
  if (!ficha) return "O SGP não devolveu dados desta OS. Se ela foi removida por lá, o histórico registra.";
  return null;
}

/**
 * Complemento e ponto de referencia, pra entrar DENTRO do card de endereco.
 *
 * Morava numa secao "Como chegar" separada, no fim da ficha — a ~700px do
 * endereco, que fica no topo da tela. Dois pedacos da mesma pergunta ("onde
 * fica a casa?") em pontas opostas do scroll: quem estava lendo o endereco nao
 * tinha como saber que havia um ponto de referencia la embaixo.
 */
export function FichaSgpComoChegar({ ficha }: { ficha: OsFichaSgp | null }) {
  if (!ficha?.enderecoComplemento && !ficha?.enderecoPontoReferencia) return null;
  return (
    <View style={{ gap: 4 }}>
      {ficha.enderecoComplemento ? <Text style={styles.texto}>{ficha.enderecoComplemento}</Text> : null}
      {ficha.enderecoPontoReferencia ? (
        <View style={styles.refRow}>
          <Feather name="map-pin" size={14} color={colors.ink2} style={{ marginTop: 3 }} />
          <Text style={[styles.texto, { flex: 1 }]}>{ficha.enderecoPontoReferencia}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Conexao do contrato: plano, estado, sinal optico e o acesso PPPoE.
 *
 * Dobrada por padrao. E consulta de referencia — importa na porta do cliente,
 * com a ONU na mao, nao no caminho ate la. Aberta o tempo todo, empurrava o
 * motivo da visita e os botoes de contato uns 900px pra baixo.
 *
 * O sinal aparece no CABECALHO mesmo fechada: e o numero que decide se vale a
 * pena abrir, e obrigar a abrir pra descobrir seria esconder de novo.
 */
export function FichaSgpConexao({ ficha, carregando, erro }: Props) {
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(rotulo: string, valor: string) {
    await Clipboard.setStringAsync(valor);
    setCopiado(rotulo);
    setTimeout(() => setCopiado(null), 1500);
  }

  const vazio = textoDoVazio({ ficha, carregando, erro });
  if (carregando) return null;
  if (vazio) {
    return (
      <Card>
        <SectionLabel>Conexão</SectionLabel>
        <Muted>{vazio}</Muted>
      </Card>
    );
  }

  const f = ficha!;
  const temPlano = f.plano || f.planoDownload || f.planoUpload;
  const temConexao =
    f.servicoOnline !== null || f.servicoIp || f.servicoMac || f.sinalRxDbm !== null || f.sinalTxDbm !== null || f.oltNome;
  const temPppoe = f.servicoLogin || f.servicoSenha;

  if (!temPlano && !temConexao && !temPppoe) {
    return (
      <Card>
        <SectionLabel>Conexão</SectionLabel>
        <Muted>Sem plano nem acesso PPPoE no SGP — normal quando o contrato está inativo.</Muted>
      </Card>
    );
  }

  return (
    <Dobravel
      titulo="Conexão e PPPoE"
      resumo={
        <>
          {f.servicoOnline !== null ? (
            <Pill label={f.servicoOnline ? "Online" : "Offline"} tone={f.servicoOnline ? "green" : "red"} />
          ) : null}
          {/* Cor aqui e semantica de sinal optico — a mesma faixa do
              provisionamento, nao uma cor decorativa. */}
          {f.sinalRxDbm !== null ? <Pill label={rotuloSinal(f.sinalRxDbm)} tone={toneSinal(f.sinalRxDbm)} /> : null}
          {f.plano ? <Muted>{f.plano}</Muted> : null}
        </>
      }
    >
      {temPlano ? (
        <View style={{ gap: space.sm }}>
          <SectionLabel>Plano contratado</SectionLabel>
          {f.plano ? <Text style={styles.destaque}>{f.plano}</Text> : null}
          {f.planoDownload || f.planoUpload ? (
            <View style={styles.linha}>
              {f.planoDownload ? <Pill label={`↓ ${f.planoDownload}`} tone="blue" /> : null}
              {f.planoUpload ? <Pill label={`↑ ${f.planoUpload}`} tone="blue" /> : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* "ultimo lido" de proposito: o botao "Verificar conexao e sinal" desta
          mesma tela faz uma sonda AO VIVO, e dois numeros de dBm sem contexto
          viram duvida no campo ("qual vale?"). Aqui e o registrado; la e agora. */}
      {temConexao ? (
        <View style={{ gap: space.sm }}>
          <SectionLabel>Estado da conexão (último lido)</SectionLabel>
          <View style={styles.linha}>
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
        </View>
      ) : null}

      {/* PPPoE: o dado que mais economiza ligacao pro escritorio. Toque copia —
          digitar login e senha de PPPoE na mao, no sol, e onde nascem os erros. */}
      {temPppoe ? (
        <View style={{ gap: space.sm }}>
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
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={senhaVisivel ? "Ocultar senha" : "Mostrar senha"}
              >
                <Feather name={senhaVisivel ? "eye-off" : "eye"} size={18} color={colors.ink2} />
              </Pressable>
              <Pressable
                onPress={() => void copiar("senha", f.servicoSenha!)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Copiar senha PPPoE"
              >
                <Feather name={copiado === "senha" ? "check" : "copy"} size={18} color={colors.brand} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </Dobravel>
  );
}

/**
 * Cadastro do assinante, o que ja foi registrado na OS e a equipe.
 *
 * Dobrada tambem, e por baixo da conexao: e conferencia de identidade ("e a
 * pessoa do contrato?") e contexto de quem passou antes — consulta pontual,
 * nao leitura de fluxo.
 */
export function FichaSgpContrato({ ficha, carregando, erro }: Props) {
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(rotulo: string, valor: string) {
    await Clipboard.setStringAsync(valor);
    setCopiado(rotulo);
    setTimeout(() => setCopiado(null), 1500);
  }

  // Erro/vazio ja foram ditos pela secao de Conexão logo acima — repetir a
  // mesma frase duas vezes seguidas so faria a tela parecer quebrada em dobro.
  if (carregando || erro || !ficha) return null;

  const f = ficha;
  const temCliente = f.clienteNome || f.clienteDocumento || f.clienteContato || f.clienteEmail || f.contratoStatus;
  const temEquipe = f.tecnicoResponsavel || f.tecnicosAuxiliares.length > 0 || f.setor;
  const temRegistro = f.servicoPrestado || f.observacao;
  if (!temCliente && !temEquipe && !temRegistro) return null;

  return (
    <Dobravel titulo="Cadastro do contrato" resumo={f.clienteNome ? <Muted>{f.clienteNome}</Muted> : undefined}>
      {temCliente ? (
        <View style={{ gap: space.sm }}>
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
        </View>
      ) : null}

      {temRegistro ? (
        <View style={{ gap: space.sm }}>
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
        </View>
      ) : null}

      {temEquipe ? (
        <View style={{ gap: 4 }}>
          <SectionLabel>Equipe e setor</SectionLabel>
          {f.tecnicoResponsavel ? <Text style={styles.texto}>Responsável: {f.tecnicoResponsavel}</Text> : null}
          {f.tecnicosAuxiliares.length > 0 ? <Muted>Apoio: {f.tecnicosAuxiliares.join(", ")}</Muted> : null}
          {f.setor ? <Muted>Setor: {f.setor}</Muted> : null}
        </View>
      ) : null}
    </Dobravel>
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
