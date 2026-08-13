import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { LinhaMovel } from "@isphub/shared";
import { percentualConsumido } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Card, Muted } from "@/components/ui";
import { colors, font, space } from "@/theme/tokens";
import { buscarMinhaLinha, type MinhaLinha } from "./api";

/**
 * "Minha linha" — o chip corporativo do tecnico, dentro do Perfil.
 *
 * O tecnico usa um chip da CITmax e nao tinha como saber quanto de franquia
 * sobrou nem se a linha esta ativa: descobria quando os dados acabavam, no meio
 * de um atendimento.
 *
 * ## A regra que organiza a tela toda
 *
 * **Nunca desenhar uma barra que o dado nao sustenta.** Sao tres situacoes que
 * um "0 GB" na tela confundiria num so:
 *
 *  - a linha nao tem pacote contratado (`consumo` ausente) → texto, sem barra;
 *  - a franquia acabou de verdade (`restanteGb: 0` com `totalGb > 0`) → barra
 *    vazia, que e a informacao correta;
 *  - a consulta falhou (`consumoIndisponivel`) → aviso de que nao deu para
 *    perguntar, e barra nenhuma.
 *
 * Sem essa separacao, uma queda de rede leria como "sua internet acabou".
 */
export function CartaoMinhaLinha() {
  const { token } = useAuth();
  const [dados, setDados] = useState<MinhaLinha | null>(null);
  const [erro, setErro] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(false);
    try {
      setDados(await buscarMinhaLinha(token));
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Sem integracao configurada o bloco simplesmente nao existe: e uma decisao do
  // administrador, e nao ha nada que o tecnico possa fazer a respeito.
  if (!carregando && !erro && dados?.estado === "sem_integracao") return null;

  return (
    <Card style={estilo.card}>
      <View style={estilo.cabeca}>
        <Feather name="smartphone" size={16} color={CIT.tealDeep} />
        <Text style={estilo.titulo}>Minha linha</Text>
        {dados?.estado === "ok" ? (
          <SeloStatus rotulo={dados.linha.statusRotulo} status={dados.linha.status} />
        ) : null}
        {!carregando ? (
          <Pressable
            onPress={() => void carregar()}
            accessibilityRole="button"
            accessibilityLabel="Atualizar minha linha"
            hitSlop={12}
            style={({ pressed }) => [estilo.recarregar, pressed && { opacity: 0.6 }]}
          >
            <Feather name="refresh-cw" size={14} color={CIT.muted} />
          </Pressable>
        ) : null}
      </View>

      {carregando ? (
        <View style={estilo.centro}>
          <ActivityIndicator color={CIT.teal} />
        </View>
      ) : erro ? (
        <Muted>Não foi possível consultar sua linha agora. Toque em atualizar para tentar de novo.</Muted>
      ) : dados?.estado === "sem_vinculo" ? (
        <Muted>
          Sua linha ainda não foi vinculada. Peça ao administrador para cadastrar seu CPF no seu
          usuário.
        </Muted>
      ) : dados?.estado === "nao_encontrada" ? (
        // Acontece quando o chip e trocado: o ponteiro guardado aponta para uma
        // linha que a operadora nao reconhece mais.
        <Muted>
          A linha vinculada ao seu usuário não foi encontrada na operadora. Se você trocou de chip,
          peça ao administrador para vincular de novo.
        </Muted>
      ) : dados?.estado === "ok" ? (
        <Conteudo linha={dados.linha} />
      ) : null}
    </Card>
  );
}

/**
 * A paleta da CITmax — a operadora dona do chip.
 *
 * Fica AQUI, e nao em `theme/tokens.ts`, de proposito: os tokens sao a
 * identidade do ISPhub (indigo), e este cartao e o unico ponto do app que fala
 * por outra marca. Espalhar teal pelos tokens globais faria o app inteiro
 * comecar a parecer da CITmax sem ninguem ter decidido isso.
 *
 * Valores conferidos contra `site-public.css` do site da CITmax.
 */
const CIT = {
  teal: "#00C896",
  tealMid: "#008B87",
  tealDeep: "#036271",
  trilho: "#E2EAE7",
  ink: "#1A2B28",
  muted: "#8A9794",
} as const;

/**
 * Cor da franquia pelo quanto SOBROU.
 *
 * O teal da marca cobre o estado normal, mas o alerta continua existindo: numa
 * tela cuja razao de ser e avisar que o dado esta acabando, pintar tudo de teal
 * apagaria justamente a informacao que importa. Marca no normal, semaforo no
 * aperto.
 */
function corDaFranquia(restantePct: number): string {
  if (restantePct >= 50) return CIT.teal;
  if (restantePct >= 20) return "#D68A00";
  return "#C0341D";
}

function Conteudo({ linha }: { linha: LinhaMovel }) {
  const consumo = linha.consumo;
  const consumido = consumo ? percentualConsumido(consumo.restanteGb, consumo.totalGb) : null;
  const restantePct = consumido === null ? null : 100 - consumido;

  return (
    <View style={{ gap: space.md }}>
      {linha.emAtivacao ? (
        <Muted>
          Linha em ativação. O número aparece aqui assim que a operadora concluir — antes disso o que
          ela informa ainda não é definitivo.
        </Muted>
      ) : (
        <Text style={estilo.numero}>{linha.numero ?? "Número indisponível"}</Text>
      )}

      {linha.consumoIndisponivel ? (
        <View style={estilo.aviso}>
          <Feather name="alert-triangle" size={14} color={colors.slaAmber} />
          <Text style={estilo.avisoTxt}>
            Não foi possível consultar o consumo agora — isto não significa que sua franquia acabou.
          </Text>
        </View>
      ) : null}

      {consumo && restantePct !== null ? (
        <View style={{ gap: space.md }}>
          <AnelConsumo restantePct={restantePct} restanteGb={consumo.restanteGb} totalGb={consumo.totalGb} />
          {consumo.categorias.length > 1 ? (
            // So quando ha MAIS DE UMA faixa: com uma so, a barra repetiria
            // exatamente o que o anel acima ja diz.
            <View style={{ gap: space.sm }}>
              {consumo.categorias.map((c) => {
                const usado = percentualConsumido(c.restanteGb, c.totalGb);
                return usado === null ? null : (
                  <BarraFranquia
                    key={c.descricao}
                    pct={100 - usado}
                    label={c.descricao}
                    restanteGb={c.restanteGb}
                    totalGb={c.totalGb}
                  />
                );
              })}
            </View>
          ) : null}
        </View>
      ) : !linha.consumoIndisponivel && !linha.emAtivacao ? (
        // `total: 0` sem categoria nenhuma NAO e franquia esgotada — e ausencia
        // de pacote. Uma barra aqui seria uma afirmacao falsa.
        <Muted>Sem pacote de dados contratado nesta linha.</Muted>
      ) : null}

      {linha.plano ? (
        <View style={estilo.plano}>
          <Text style={estilo.planoNome}>{linha.plano.nome}</Text>
          {linha.plano.descricao ? <Muted>{linha.plano.descricao}</Muted> : null}
          {linha.plano.fimEm ? (
            <Text style={estilo.renova}>
              {linha.plano.recorrente ? "Renova em " : "Válido até "}
              {fmtData(linha.plano.fimEm)}
              {diasAte(linha.plano.fimEm) !== null ? ` · ${textoDias(diasAte(linha.plano.fimEm)!)}` : ""}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * O medidor de franquia do ciclo ATUAL.
 *
 * Um arco de tracos em vez de uma barra: o tecnico olha isto de relance, com uma
 * mao, sob sol — e a leitura "quanto ainda tenho" e imediata num mostrador
 * redondo, do jeito que todo app de operadora ensina.
 *
 * **Desenhado com Views, sem biblioteca de grafico.** Trazer `react-native-svg`
 * seria um MODULO NATIVO novo: o dev client instalado nos aparelhos pararia de
 * funcionar ate ser recompilado, e o app quebraria na abertura com
 * `NativeModule.X is null`. Um mostrador nao vale esse custo.
 *
 * Cada traco e uma View girada em torno do centro e empurrada para fora — a
 * ordem do `transform` importa: `rotate` primeiro, e o `translateY` seguinte ja
 * anda na direcao girada.
 */
function AnelConsumo({
  restantePct,
  restanteGb,
  totalGb,
}: {
  restantePct: number;
  restanteGb: number;
  totalGb: number;
}) {
  const pct = Math.max(0, Math.min(100, restantePct));
  const tom = corDaFranquia(pct);
  const acesos = Math.round((pct / 100) * TRACOS);

  return (
    <View style={estilo.anelWrap}>
      <View style={{ width: ANEL, height: ANEL }}>
        {Array.from({ length: TRACOS }, (_, i) => {
          // Arco de 270 graus aberto embaixo — o vao inferior e o que faz o
          // desenho ler como medidor, e nao como pizza.
          const ang = -135 + (i / (TRACOS - 1)) * 270;
          const aceso = i < acesos;
          return (
            <View
              key={i}
              style={[
                estilo.traco,
                aceso ? { backgroundColor: tom } : null,
                { transform: [{ rotate: `${ang}deg` }, { translateY: -RAIO }] },
              ]}
            />
          );
        })}
        <View style={estilo.anelCentro}>
          <Text style={[estilo.anelNumero, { color: tom }]}>{fmtNumero(restanteGb)}</Text>
          <Text style={estilo.anelUnidade}>GB restantes</Text>
          <Text style={estilo.anelTotal}>de {fmtNumero(totalGb)} GB</Text>
        </View>
      </View>
      <Text style={estilo.anelLegenda}>
        {fmtNumero(Math.max(0, totalGb - restanteGb))} GB usados neste ciclo
      </Text>
    </View>
  );
}

/**
 * Uma faixa da franquia (dados, bonus, redes sociais).
 *
 * Local, e nao o `BarraProgresso` do `painel-dia`: aquele veste a identidade do
 * ISPhub e e usado na home inteira. Mudar a cor dele para pintar este cartao
 * levaria teal para telas que nao tem nada a ver com a operadora.
 */
function BarraFranquia({
  pct,
  label,
  restanteGb,
  totalGb,
}: {
  pct: number;
  label: string;
  restanteGb: number;
  totalGb: number;
}) {
  const seguro = Math.max(0, Math.min(100, pct));
  const tom = corDaFranquia(seguro);
  return (
    <View accessible accessibilityLabel={`${label}: ${fmtNumero(restanteGb)} de ${fmtNumero(totalGb)} GB`}>
      <View style={estilo.barraTopo}>
        <Text style={estilo.barraLabel}>{label}</Text>
        <Text style={[estilo.barraValor, { color: tom }]}>
          {fmtNumero(restanteGb)} / {fmtNumero(totalGb)} GB
        </Text>
      </View>
      <View style={estilo.barraTrilho}>
        {/* Piso de 2%: uma sobra minima ainda precisa ser visivel como sobra. */}
        <View style={[estilo.barraCheio, { width: `${Math.max(2, seguro)}%`, backgroundColor: tom }]} />
      </View>
    </View>
  );
}

/**
 * O selo de status, nas cores da operadora.
 *
 * Proprio em vez do `Pill` do kit: os tons dele sao os do ISPhub, e "Ativa" sair
 * no verde do SLA misturaria dois vocabularios de cor no mesmo cartao.
 */
function SeloStatus({ rotulo, status }: { rotulo: string; status: string }) {
  const cor =
    status === "ACTIVE"
      ? { bg: "#E1F7F0", fg: CIT.tealMid }
      : status === "PRE_ACTIVE"
        ? { bg: "#FBF1DF", fg: "#8A5A00" }
        : status === "BLOCKED"
          ? { bg: "#FBE9E6", fg: "#C0341D" }
          : { bg: "#EFF2F1", fg: CIT.muted };
  return (
    <View style={[estilo.selo, { backgroundColor: cor.bg }]}>
      <Text style={[estilo.seloTxt, { color: cor.fg }]}>{rotulo}</Text>
    </View>
  );
}

/** Uma casa e virgula — "8,5" e como se le franquia no Brasil. Inteiro sem ",0". */
function fmtNumero(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
}

function fmtData(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

/** Dias inteiros ate a data. Negativo = ja passou. `null` se a data nao presta. */
function diasAte(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

function textoDias(dias: number): string {
  if (dias < 0) return "vencido";
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias`;
}

/** Geometria do medidor. `RAIO` e a distancia do centro ate o meio do traco. */
const ANEL = 168;
const RAIO = 68;
const TRACOS = 44;

const estilo = StyleSheet.create({
  card: { gap: space.md },
  anelWrap: { alignItems: "center", gap: space.xs },
  traco: {
    position: "absolute",
    width: 4,
    height: 14,
    borderRadius: 2,
    backgroundColor: CIT.trilho,
    // Centralizado no container ANTES do transform — e o `translateY` que joga
    // cada traco para a borda, ja na inclinacao certa.
    left: (ANEL - 4) / 2,
    top: (ANEL - 14) / 2,
  },
  anelCentro: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  anelNumero: {
    fontSize: 40,
    fontWeight: font.weight.black as "800",
    fontVariant: ["tabular-nums"],
    lineHeight: 44,
  },
  anelUnidade: {
    fontSize: font.size.sm,
    fontWeight: font.weight.medium as "600",
    color: CIT.tealDeep,
  },
  anelTotal: { fontSize: font.size.xs, color: CIT.muted, fontVariant: ["tabular-nums"] },
  selo: { marginLeft: "auto", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  seloTxt: { fontSize: font.size.xs, fontWeight: font.weight.medium as "600" },
  barraTopo: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  barraLabel: { fontSize: font.size.sm, color: CIT.ink },
  barraValor: {
    fontSize: font.size.sm,
    fontWeight: font.weight.medium as "600",
    fontVariant: ["tabular-nums"],
  },
  barraTrilho: { height: 8, borderRadius: 4, backgroundColor: CIT.trilho, overflow: "hidden" },
  barraCheio: { height: "100%", borderRadius: 4 },
  anelLegenda: { fontSize: font.size.sm, color: CIT.muted, fontVariant: ["tabular-nums"] },
  cabeca: { flexDirection: "row", alignItems: "center", gap: space.sm },
  titulo: { fontSize: font.size.base, fontWeight: font.weight.bold as "700", color: CIT.ink },
  recarregar: { marginLeft: space.xs, padding: 2 },
  centro: { paddingVertical: space.lg, alignItems: "center" },
  numero: {
    fontSize: 24,
    fontWeight: font.weight.bold as "700",
    color: CIT.ink,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.5,
  },
  gb: { fontSize: font.size.sm, color: colors.ink2, fontVariant: ["tabular-nums"] },
  aviso: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "flex-start",
    backgroundColor: colors.slaAmberBg,
    borderRadius: 10,
    padding: space.sm,
  },
  avisoTxt: { flex: 1, fontSize: font.size.sm, color: colors.ink2, lineHeight: 18 },
  plano: {
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: CIT.trilho,
    paddingTop: space.md,
  },
  planoNome: { fontSize: font.size.base, fontWeight: font.weight.medium as "600", color: CIT.tealDeep },
  renova: { fontSize: font.size.sm, color: CIT.muted, marginTop: 2 },
});
