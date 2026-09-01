import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, font, radius, shadow, space } from "@/theme/tokens";
import { Card, Pill, type PillTone } from "@/components/ui";

/**
 * Blocos do "painel do dia" — a home do tecnico.
 *
 * Separados de `ui.tsx` (que e o vocabulario generico do app) porque estes
 * existem por causa DESTA tela e do trabalho dela: sao a resposta a "como esta
 * meu dia e o que eu faco agora?".
 *
 * Duas regras valem em tudo aqui:
 *
 *  - **`tabular-nums` em todo numero que muda.** Sem isso o cronometro e os
 *    contadores mudam de LARGURA a cada tick, e a linha inteira treme. E o tipo
 *    de defeito que ninguem sabe nomear mas todo mundo sente.
 *  - **Cor so com significado.** `tokens.ts` reserva cor forte pra semantica de
 *    dado (SLA, sinal). Um KPI e verde porque significa "no prazo", nunca
 *    porque verde ficou bonito ali.
 */

const NUM = { fontVariant: ["tabular-nums" as const] };

/* ---------------------------------------------------------------- KPI ---- */

export type TomKpi = "neutro" | "brand" | "verde" | "ambar" | "vermelho";

const TOM_KPI: Record<TomKpi, { fg: string; bg: string }> = {
  neutro: { fg: colors.ink, bg: colors.cardAlt },
  brand: { fg: colors.brandInk, bg: colors.brandBg },
  verde: { fg: colors.slaGreen, bg: colors.slaGreenBg },
  ambar: { fg: colors.slaAmber, bg: colors.slaAmberBg },
  vermelho: { fg: colors.slaRed, bg: colors.slaRedBg },
};

/**
 * Um numero do dia. Era funcao local dentro de `minhas-os/index.tsx`, invisivel
 * pro resto do app; virou componente porque a home passou a ter quatro.
 */
export function Kpi({
  valor,
  label,
  tom = "neutro",
  icone,
}: {
  valor: number;
  label: string;
  tom?: TomKpi;
  icone?: keyof typeof Feather.glyphMap;
}) {
  const c = TOM_KPI[tom];
  return (
    <View
      style={[estilo.kpi, { backgroundColor: c.bg }]}
      // Uma leitura so pro leitor de tela: "8 programadas", nao "8" e depois
      // "programadas" em outro foco.
      accessible
      accessibilityLabel={`${valor} ${label}`}
    >
      {icone ? <Feather name={icone} size={15} color={c.fg} /> : null}
      <Text style={[estilo.kpiValor, NUM, { color: c.fg }]}>{valor}</Text>
      <Text style={estilo.kpiLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/* --------------------------------------------------------- Progresso ---- */

/**
 * Quanto do dia ja saiu do caminho.
 *
 * O numero acompanha a barra em texto de proposito: barra sozinha e informacao
 * so na forma, e sob sol forte a diferenca entre 40% e 55% de preenchimento
 * simplesmente nao se le.
 */
export function BarraProgresso({ pct, label }: { pct: number; label: string }) {
  const seguro = Math.max(0, Math.min(100, pct));
  const tom = seguro >= 70 ? colors.slaGreen : seguro >= 40 ? colors.slaAmber : colors.slaRed;
  return (
    <View accessible accessibilityLabel={`${label}: ${seguro} por cento`}>
      <View style={estilo.progLinha}>
        <Text style={estilo.progLabel}>{label}</Text>
        <Text style={[estilo.progPct, NUM, { color: tom }]}>{seguro}%</Text>
      </View>
      <View style={estilo.progTrilho}>
        <View style={[estilo.progPreenchido, { width: `${seguro}%`, backgroundColor: tom }]} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------ Próxima OS ---- */

/**
 * A unica coisa acionavel agora.
 *
 * Ganha o maior peso visual da tela porque, das dez OS do dia, so uma importa
 * neste minuto — e o custo de o tecnico ler a lista inteira pra descobrir qual
 * e paga-se em cada parada.
 */
export function ProximaOs({
  titulo,
  cliente,
  endereco,
  horario,
  prioridadeAlta,
  distancia,
  onVer,
  onIniciar,
  acaoLabel = "Iniciar deslocamento",
}: {
  titulo: string;
  cliente: string;
  endereco?: string | null;
  horario?: string | null;
  prioridadeAlta?: boolean;
  distancia?: string | null;
  onVer: () => void;
  onIniciar: () => void;
  acaoLabel?: string;
}) {
  return (
    <Card style={estilo.proxima}>
      <View style={estilo.proxTopo}>
        <View style={estilo.proxSelo}>
          <Feather name="navigation" size={13} color={colors.brandInk} />
          <Text style={estilo.proxSeloTxt}>PRÓXIMA PARADA</Text>
        </View>
        {/* `prioridade` existe no tipo desde sempre e nunca foi mostrada no
            app — uma OS ALTA chegava indistinguivel das outras. */}
        {prioridadeAlta ? <Pill label="Prioridade ALTA" tone="red" /> : null}
      </View>

      <Text style={estilo.proxTitulo} numberOfLines={2}>
        {titulo}
      </Text>

      <View style={estilo.proxLinhas}>
        <LinhaInfo icone="user" texto={cliente} />
        {endereco ? <LinhaInfo icone="map-pin" texto={endereco} /> : null}
        {horario ? <LinhaInfo icone="clock" texto={horario} numerico /> : null}
        {distancia ? <LinhaInfo icone="map" texto={distancia} numerico /> : null}
      </View>

      <View style={estilo.proxAcoes}>
        <Pressable
          onPress={onVer}
          accessibilityRole="button"
          accessibilityLabel="Ver a ordem de serviço"
          style={({ pressed }) => [estilo.btnSec, pressed && { opacity: 0.7 }]}
        >
          <Feather name="eye" size={16} color={colors.brandInk} />
          <Text style={estilo.btnSecTxt}>Ver OS</Text>
        </Pressable>
        <Pressable
          onPress={onIniciar}
          accessibilityRole="button"
          accessibilityLabel={acaoLabel}
          style={({ pressed }) => [estilo.btnPri, pressed && { opacity: 0.85 }]}
        >
          <Feather name="navigation" size={16} color={colors.onBrand} />
          <Text style={estilo.btnPriTxt} numberOfLines={1}>
            {acaoLabel}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

function LinhaInfo({
  icone,
  texto,
  numerico,
}: {
  icone: keyof typeof Feather.glyphMap;
  texto: string;
  numerico?: boolean;
}) {
  return (
    <View style={estilo.infoLinha}>
      <Feather name={icone} size={14} color={colors.muted} style={estilo.infoIcone} />
      <Text style={[estilo.infoTxt, numerico && NUM]} numberOfLines={2}>
        {texto}
      </Text>
    </View>
  );
}

/* --------------------------------------------------------- Agenda ---- */

export type EstadoAgenda = "concluida" | "andamento" | "proxima" | "programada" | "problema";

const AGENDA: Record<EstadoAgenda, { icone: keyof typeof Feather.glyphMap; cor: string; pill?: PillTone }> = {
  concluida: { icone: "check-circle", cor: colors.slaGreen },
  andamento: { icone: "play-circle", cor: colors.blue },
  proxima: { icone: "disc", cor: colors.brand, pill: "brand" },
  programada: { icone: "circle", cor: colors.line2 },
  problema: { icone: "alert-triangle", cor: colors.slaAmber },
};

/**
 * Uma parada do dia.
 *
 * O horario fica FORA da coluna de icones, alinhado a esquerda e tabular: a
 * agenda e lida verticalmente procurando "que horas", e numero desalinhado
 * obriga a ler item por item.
 */
export function LinhaAgenda({
  horario,
  titulo,
  estado,
  rotulo,
  onPress,
  ultimo,
}: {
  horario: string;
  titulo: string;
  estado: EstadoAgenda;
  rotulo: string;
  onPress?: () => void;
  ultimo?: boolean;
}) {
  const a = AGENDA[estado];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${horario}, ${titulo}, ${rotulo}`}
      style={({ pressed }) => [estilo.agLinha, estado === "proxima" && estilo.agAtual, pressed && { opacity: 0.7 }]}
    >
      <Text style={[estilo.agHora, NUM]}>{horario}</Text>
      <View style={estilo.agTrilho}>
        <Feather name={a.icone} size={16} color={a.cor} />
        {/* O fio que liga as paradas — some no ultimo pra nao apontar pro vazio. */}
        {!ultimo ? <View style={estilo.agFio} /> : null}
      </View>
      <View style={estilo.agCorpo}>
        <Text style={estilo.agTitulo} numberOfLines={1}>
          {titulo}
        </Text>
      </View>
      {/*
        Coluna de largura fixa pro rotulo. Pill e Text tem alturas diferentes, e
        sem um container proprio a coluna da direita oscilava de linha pra linha
        — a agenda e lida verticalmente, entao rotulo dancando obriga a reler.
      */}
      <View style={estilo.agRotuloCol}>
        {a.pill ? (
          <Pill label={rotulo} tone={a.pill} />
        ) : (
          <Text style={[estilo.agRotulo, { color: a.cor === colors.line2 ? colors.muted : a.cor }]} numberOfLines={1}>
            {rotulo}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/* -------------------------------------------------------- Atalhos ---- */

export interface Atalho {
  id: string;
  label: string;
  icone: keyof typeof Feather.glyphMap;
  onPress: () => void;
  /** Numero sobreposto (ex.: pendencias). Zero nao desenha nada. */
  badge?: number;
}

/**
 * Grade de atalhos — atalho pra CONTEUDO, nunca navegacao paralela.
 *
 * A referencia empilha hamburguer + atalhos + abas, tres camadas pro mesmo
 * nivel. O app ja tem 5 abas (o teto do Material) e o rotulo "Conversas ..."
 * ja trunca a 375px; mais uma aba quebraria a barra. Entao o que nao merece
 * aba vem pra ca.
 */
export function GradeAtalhos({ itens }: { itens: Atalho[] }) {
  return (
    <View style={estilo.grade}>
      {itens.map((a) => (
        <Pressable
          key={a.id}
          onPress={a.onPress}
          accessibilityRole="button"
          accessibilityLabel={a.badge ? `${a.label}, ${a.badge} pendente(s)` : a.label}
          style={({ pressed }) => [estilo.atalho, pressed && { opacity: 0.7 }]}
        >
          <View style={estilo.atalhoIcone}>
            <Feather name={a.icone} size={20} color={colors.brandInk} />
            {a.badge ? (
              <View style={estilo.atalhoBadge}>
                <Text style={[estilo.atalhoBadgeTxt, NUM]}>{a.badge > 9 ? "9+" : a.badge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={estilo.atalhoTxt} numberOfLines={1}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/* --------------------------------------------------------- Aviso ---- */

/** Faixa de atencao (fila cortada, pendencia). Icone + texto, nunca so cor. */
export function Aviso({ texto, onPress }: { texto: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "alert"}
      style={({ pressed }) => [estilo.aviso, pressed && { opacity: 0.8 }]}
    >
      <Feather name="alert-triangle" size={16} color={colors.slaAmber} />
      <Text style={estilo.avisoTxt}>{texto}</Text>
      {onPress ? <Feather name="chevron-right" size={16} color={colors.slaAmber} /> : null}
    </Pressable>
  );
}


/* -------------------------------------------------------- Jornada ---- */

/**
 * O turno — o quadro dentro do qual o resto do dia acontece.
 *
 * Fica no TOPO por isso: antes de saber qual e a proxima parada, o tecnico
 * precisa saber se ja esta em servico. Fora de jornada, um botao so; em
 * jornada, o relogio e a saida.
 *
 * O tempo vem pronto de fora (`tempo`), calculado com o relogio do SERVIDOR —
 * este componente nao chama `Date.now()` de proposito, pra nao existir um
 * segundo lugar capaz de discordar sobre que horas sao.
 */
export function CardJornada({
  inicio,
  tempo,
  precisaAtencao,
  temLocalizacao,
  ocupado,
  viatura,
  onIniciar,
  onEncerrar,
  onTrocarViatura,
}: {
  /** "07:42" — nulo quando nao ha jornada aberta. */
  inicio: string | null;
  /** "5h58" — idem. */
  tempo: string | null;
  precisaAtencao?: boolean;
  temLocalizacao?: boolean;
  ocupado?: boolean;
  /** "HFX-3652 · motorista" — nulo quando o tecnico foi a pe. */
  viatura?: string | null;
  onIniciar: () => void;
  onEncerrar: () => void;
  onTrocarViatura?: () => void;
}) {
  if (!inicio || !tempo) {
    /*
     * O botao mora numa SUPERFICIE, e nao solto na tela, pelo mesmo motivo que
     * o estado de jornada aberta (logo abaixo) tambem e uma superficie: este
     * bloco cavalga o Hero — `conteudo` sobe com marginTop negativo sobre o
     * padding extra dele.
     *
     * Solto, o botao era `colors.brand` sobre um Hero `colors.brand`: contraste
     * 1.00:1, literalmente a mesma cor. E trocar o tom do botao NAO resolvia —
     * ele cavalga duas superficies de luminancias opostas (Hero 0.117, ground
     * 0.888), entao nenhum preenchimento chapado alcanca 3:1 contra as duas.
     * Medido: teal 1.68, verde 1.16, brandInk 1.28, ate quase-preto so 2.67
     * contra o Hero. O que resolve e a superficie clara embaixo: 6.29:1 contra
     * o Hero, com o botao indigo em cima dela a 6.29:1.
     */
    return (
      <View style={estilo.jorParada}>
        <View style={estilo.jorTopo}>
          <Feather name="clock" size={15} color={colors.ink2} />
          <Text style={estilo.jorParadaTitulo}>Jornada não iniciada</Text>
        </View>
        <Pressable
          onPress={onIniciar}
          disabled={ocupado}
          accessibilityRole="button"
          accessibilityLabel="Iniciar jornada"
          accessibilityState={{ disabled: !!ocupado, busy: !!ocupado }}
          style={({ pressed }) => [estilo.jorFora, pressed && estilo.jorForaPress, ocupado && { opacity: 0.6 }]}
        >
          <Feather name="play-circle" size={18} color={colors.onBrand} />
          <Text style={estilo.jorForaTxt}>{ocupado ? "Iniciando…" : "Iniciar jornada"}</Text>
        </Pressable>
      </View>
    );
  }

  const tom = precisaAtencao
    ? { bg: colors.slaAmberBg, fg: colors.slaAmber }
    : { bg: colors.slaGreenBg, fg: colors.slaGreen };

  return (
    <View style={[estilo.jornada, { backgroundColor: tom.bg }]}>
      <View style={estilo.jorLinha}>
        <View style={estilo.jorInfo}>
          <View style={estilo.jorTopo}>
            <Feather name={precisaAtencao ? "alert-triangle" : "activity"} size={15} color={tom.fg} />
            <Text style={[estilo.jorTitulo, { color: tom.fg }]}>Jornada iniciada — {inicio}</Text>
          </View>
          <Text style={estilo.jorTempo}>
            Tempo trabalhado: <Text style={[estilo.jorTempoNum, NUM, { color: tom.fg }]}>{tempo}</Text>
          </Text>
          {/*
            O aviso e a UNICA defesa contra "esqueci de encerrar ontem" — a
            jornada nao fecha sozinha, entao ele precisa ser impossivel de ler
            como normal.
          */}
          {precisaAtencao ? (
            <Text style={[estilo.jorAviso, { color: tom.fg }]}>Aberta há mais de 12h — confira se esqueceu de encerrar.</Text>
          ) : temLocalizacao ? (
            <View style={estilo.jorGeo}>
              <Feather name="map-pin" size={12} color={colors.ink2} />
              <Text style={estilo.jorGeoTxt}>Localização registrada no início</Text>
            </View>
          ) : null}

          {/*
            A viatura na MESMA sublinha da localizacao, e nao num bloco proprio:
            as duas respondem "o que ficou registrado quando abri o turno".
            Toca-la troca de carro sem encerrar a jornada — o caso do carro que
            quebra no meio do dia.
          */}
          {onTrocarViatura ? (
            <Pressable
              onPress={onTrocarViatura}
              disabled={ocupado}
              accessibilityRole="button"
              accessibilityLabel={viatura ? `Viatura ${viatura}. Tocar para trocar.` : "Declarar viatura"}
              style={({ pressed }) => [estilo.jorGeo, pressed && { opacity: 0.7 }]}
            >
              <Feather name="truck" size={12} color={colors.ink2} />
              <Text style={estilo.jorGeoTxt}>{viatura ?? "Sem viatura declarada"}</Text>
              <Feather name="edit-2" size={11} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={onEncerrar}
          disabled={ocupado}
          accessibilityRole="button"
          accessibilityLabel="Encerrar jornada"
          style={({ pressed }) => [estilo.jorBtn, { backgroundColor: tom.fg }, pressed && { opacity: 0.85 }]}
        >
          <Feather name="stop-circle" size={15} color={colors.onBrand} />
          <Text style={estilo.jorBtnTxt}>{ocupado ? "…" : "Encerrar"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* -------------------------------------------------------- Secao ---- */


/** Titulo de secao com ação opcional à direita ("Ver todas (8)"). */
export function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <View style={estilo.secao}>
      <View style={estilo.secaoTopo}>
        <Text style={estilo.secaoTitulo}>{titulo}</Text>
        {acao}
      </View>
      {children}
    </View>
  );
}

const estilo = StyleSheet.create({
  kpi: {
    /*
     * 2x2, nao 4x1. A 375px quatro colunas deixam ~72px por rotulo, e
     * "Programadas" mede ~78 — o React Native entao quebra NO MEIO da palavra
     * ("Programa/das"). Rotulo ilegivel nao e indicador; a linha extra custa
     * menos que o numero que ninguem entende.
     */
    flexGrow: 1,
    flexBasis: "44%",
    minWidth: 130,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    alignItems: "center",
    gap: 2,
  },
  kpiValor: { fontSize: font.size.xxl, fontWeight: font.weight.black },
  kpiLabel: { fontSize: font.size.xs, color: colors.ink2, textAlign: "center" },

  progLinha: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: space.xs },
  progLabel: { fontSize: font.size.sm, color: colors.ink2 },
  progPct: { fontSize: font.size.base, fontWeight: font.weight.bold },
  progTrilho: { height: 8, borderRadius: radius.pill, backgroundColor: colors.line, overflow: "hidden" },
  progPreenchido: { height: "100%", borderRadius: radius.pill },

  proxima: { gap: space.md, ...shadow.md },
  proxTopo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  proxSelo: { flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1 },
  proxSeloTxt: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.brandInk,
    letterSpacing: 0.5,
  },
  proxTitulo: { fontSize: font.size.xl, fontWeight: font.weight.black, color: colors.ink },
  proxLinhas: { gap: space.sm },
  proxAcoes: { flexDirection: "row", gap: space.sm },

  infoLinha: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  infoIcone: { marginTop: 2 },
  infoTxt: { flex: 1, fontSize: font.size.base, color: colors.ink2, lineHeight: 21 },

  // 48 de altura: alvo confortavel de luva, acima do minimo de 44pt.
  btnSec: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  btnSecTxt: { fontSize: font.size.base, fontWeight: font.weight.bold, color: colors.brandInk },
  btnPri: {
    flex: 1.4,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingHorizontal: space.sm,
  },
  btnPriTxt: { fontSize: font.size.base, fontWeight: font.weight.bold, color: colors.onBrand },

  agLinha: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  agAtual: { backgroundColor: colors.brandBg },
  agHora: { width: 46, fontSize: font.size.sm, fontWeight: font.weight.medium, color: colors.ink2 },
  agTrilho: { width: 18, alignItems: "center", alignSelf: "stretch", justifyContent: "center" },
  agFio: { position: "absolute", top: "72%", bottom: -space.xs, width: 2, backgroundColor: colors.line },
  agCorpo: { flex: 1 },
  agTitulo: { fontSize: font.size.sm, fontWeight: font.weight.medium, color: colors.ink },
  agRotuloCol: { width: 92, alignItems: "flex-end", justifyContent: "center" },
  agRotulo: { fontSize: font.size.xs, fontWeight: font.weight.medium, textAlign: "right" },

  grade: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  atalho: {
    flexGrow: 1,
    flexBasis: "22%",
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  atalhoIcone: { alignItems: "center", justifyContent: "center" },
  atalhoBadge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.slaRed,
    alignItems: "center",
    justifyContent: "center",
  },
  atalhoBadgeTxt: { fontSize: 10, fontWeight: font.weight.bold, color: colors.onBrand },
  atalhoTxt: { fontSize: font.size.xs, fontWeight: font.weight.medium, color: colors.ink2, textAlign: "center" },

  aviso: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.slaAmberBg,
  },
  avisoTxt: { flex: 1, fontSize: font.size.sm, color: colors.slaAmber, fontWeight: font.weight.medium },

  jorFora: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    /*
     * Raio MENOR que o do `jorParada` que o envolve (radius.md). Cantos
     * concentricos pedem interno < externo; iguais, o de dentro parece mais
     * redondo que o de fora e a borda fica com espessura visualmente irregular.
     */
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    /*
     * Sem `shadow.brand` aqui. Aquele glow indigo existe pra um botao que
     * flutua sozinho sobre o fundo da pagina; dentro de um card que ja tem
     * elevacao propria, viram duas sombras empilhadas no mesmo palmo de tela
     * (e no Android, elevation 6 dentro de elevation 2 desenha errado). A
     * separacao aqui quem faz e o card, nao o brilho.
     */
  },
  // Mesmo feedback do Button compartilhado (ui.tsx `btnPressed`): opacidade
  // com escala. So opacidade nao da a sensacao de empurrar.
  jorForaPress: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  jorForaTxt: { fontSize: font.size.lg, fontWeight: font.weight.bold, color: colors.onBrand },

  jornada: { borderRadius: radius.md, padding: space.md },
  // Superficie do estado "sem jornada". Branca (nao tingida) de proposito: os
  // tons do `jornada` acima carregam STATUS (verde = correndo, ambar = atencao)
  // e aqui nao ha nada correndo.
  jorParada: { borderRadius: radius.md, padding: space.md, backgroundColor: colors.card, gap: space.sm, ...shadow.sm },
  jorParadaTitulo: { fontSize: font.size.sm, fontWeight: font.weight.bold as "700", color: colors.ink2 },
  jorLinha: { flexDirection: "row", alignItems: "center", gap: space.sm },
  jorInfo: { flex: 1, gap: 2 },
  jorTopo: { flexDirection: "row", alignItems: "center", gap: space.xs },
  jorTitulo: { fontSize: font.size.sm, fontWeight: font.weight.bold },
  jorTempo: { fontSize: font.size.sm, color: colors.ink2 },
  jorTempoNum: { fontSize: font.size.lg, fontWeight: font.weight.black },
  jorAviso: { fontSize: font.size.xs, fontWeight: font.weight.medium, marginTop: 2 },
  jorGeo: { flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: 2 },
  jorGeoTxt: { fontSize: font.size.xs, color: colors.ink2 },
  // 48 de altura mesmo sendo botao secundario: encerrar jornada e acao de fim
  // de dia, muitas vezes com luva e uma mao so.
  jorBtn: {
    minHeight: 48,
    paddingHorizontal: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    borderRadius: radius.md,
  },
  jorBtnTxt: { fontSize: font.size.sm, fontWeight: font.weight.bold, color: colors.onBrand },

  secao: { gap: space.sm },
  secaoTopo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  secaoTitulo: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.muted,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});
