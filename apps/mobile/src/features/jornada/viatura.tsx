import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useQuery } from "@tanstack/react-query";
import { EMOJI_VEICULO, type PapelOcupacao, type TipoVeiculo } from "@isphub/shared";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, font, radius, space } from "@/theme/tokens";
import { Button } from "@/components/ui";

/**
 * SELETOR DE VIATURA — a metade que faltava.
 *
 * A rota `POST /jornada/iniciar` aceita `{veiculoId, papel, odometro, colegas[]}`
 * desde a fatia de ocupacao, mas o app mandava so a geolocalizacao. Na pratica,
 * so dava pra declarar ocupacao pela API: nenhum tecnico conseguia fazer isso
 * pelo celular, e a tabela de ocupacao ficava vazia.
 *
 * Tres decisoes de tela, todas por causa de quem usa isto — alguem em pe na
 * calcada, com uma mao, no sol:
 *
 * 1. **"Sem veículo hoje" fica em DESTAQUE, nao escondido num canto.** Quem foi
 *    a pe abre o turno igual, e obrigar a escolher um carro produziria ocupacao
 *    falsa — pior que ocupacao nenhuma, porque parece dado.
 *
 * 2. **Viatura ocupada nao e bloqueada, e perguntada.** Dois tecnicos no mesmo
 *    carro E o caso comum. A folha mostra quem ja esta dentro e oferece as duas
 *    saidas: entrar junto (passageiro) ou assumir (motorista).
 *
 * 3. **A folha nao trava.** `Pular` fecha e inicia a jornada sem viatura. A
 *    jornada e o dado principal; a viatura e complemento — a mesma regra do geo,
 *    que tambem nao impede bater o inicio.
 */

export interface OcupanteResumo {
  usuarioId: string;
  nome: string;
  papel: PapelOcupacao;
}

export interface VeiculoParaJornada {
  id: string;
  placa: string;
  placaFormatada: string;
  /** `"C011 · RGI4H16"` — do servidor, igual ao da web. */
  rotulo: string;
  modelo: string;
  tipo: TipoVeiculo;
  ocupantes: OcupanteResumo[];
}

export interface ColegaResumo {
  id: string;
  nome: string;
  nomeExibicao: string | null;
}

/** A escolha do tecnico, pronta pro corpo de `POST /jornada/iniciar`. */
export interface EscolhaViatura {
  veiculoId: string;
  papel: PapelOcupacao;
  colegas: { usuarioId: string; papel: PapelOcupacao }[];
}

export function useVeiculosParaJornada(ativo: boolean) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["frota", "veiculos-para-jornada"],
    enabled: !!token && ativo,
    queryFn: () => apiFetch<VeiculoParaJornada[]>("/frota/veiculos-para-jornada", { token }),
    /*
     * Quem esta em cada carro muda enquanto a folha esta aberta — um colega
     * pode declarar a mesma viatura nesse minuto. Refazer ao montar evita
     * mostrar "livre" um carro que acabou de ser ocupado.
     */
    staleTime: 0,
  });
}

export function useColegas(ativo: boolean) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["frota", "colegas"],
    enabled: !!token && ativo,
    /*
     * Rota propria, e nao `GET /tecnicos`: aquela e ADMIN/GESTOR, com o
     * comentario explicito de que um tecnico nunca precisa da lista dos outros.
     * O seletor de acompanhantes contradiz aquilo num caso especifico — entao
     * abriu-se um caso especifico, nao a guarda toda.
     */
    queryFn: () => apiFetch<ColegaResumo[]>("/frota/colegas", { token }),
  });
}

export function FolhaViatura({
  visivel,
  titulo = "Qual viatura hoje?",
  rotuloPular = "Sem veículo hoje",
  onFechar,
  onEscolher,
  onSemVeiculo,
  ocupado,
}: {
  visivel: boolean;
  titulo?: string;
  rotuloPular?: string;
  onFechar: () => void;
  onEscolher: (escolha: EscolhaViatura) => void;
  /** Iniciar o turno sem declarar viatura nenhuma. */
  onSemVeiculo: () => void;
  ocupado?: boolean;
}) {
  const veiculos = useVeiculosParaJornada(visivel);
  const colegas = useColegas(visivel);

  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [papel, setPapel] = useState<PapelOcupacao>("motorista");
  const [comigo, setComigo] = useState<string[]>([]);

  const veiculo = useMemo(() => veiculos.data?.find((v) => v.id === selecionado) ?? null, [veiculos.data, selecionado]);

  function escolher(v: VeiculoParaJornada) {
    setSelecionado(v.id);
    /*
     * Carro com gente dentro ja abre em "passageiro": o palpite seguro e o que
     * NAO desloca ninguem. Assumir o volante continua a um toque de distancia,
     * e ai e uma acao deliberada, nao o padrao.
     */
    setPapel(v.ocupantes.some((o) => o.papel === "motorista") ? "passageiro" : "motorista");
  }

  function confirmar() {
    if (!veiculo) return;
    onEscolher({
      veiculoId: veiculo.id,
      papel,
      colegas: comigo.map((usuarioId) => ({
        usuarioId,
        papel: "passageiro" as PapelOcupacao,
      })),
    });
  }

  const jaTemMotorista = veiculo?.ocupantes.some((o) => o.papel === "motorista") ?? false;

  return (
    <Modal transparent visible={visivel} animationType="slide" onRequestClose={onFechar}>
      <Pressable style={e.fundo} onPress={onFechar} accessibilityLabel="Fechar" />
      <View style={e.folha}>
        <View style={e.puxador} />
        <Text style={e.titulo}>{titulo}</Text>

        {veiculos.isLoading ? (
          <View style={e.centro}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : veiculos.isError ? (
          <View style={e.centro}>
            <Text style={e.erro}>Não foi possível carregar as viaturas.</Text>
            <Button label="Tentar de novo" variant="ghost" size="sm" onPress={() => void veiculos.refetch()} />
          </View>
        ) : (veiculos.data?.length ?? 0) === 0 ? (
          <View style={e.centro}>
            <Text style={e.erro}>Nenhuma viatura cadastrada.</Text>
          </View>
        ) : (
          <ScrollView style={e.rolagem} contentContainerStyle={e.rolagemInterna}>
            {veiculos.data!.map((v) => {
              const ativo = selecionado === v.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => escolher(v)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ativo }}
                  accessibilityLabel={`Viatura ${v.rotulo}, ${v.modelo}${
                    v.ocupantes.length > 0 ? `, com ${v.ocupantes.map((o) => o.nome).join(", ")}` : ", livre"
                  }`}
                  style={({ pressed }) => [e.item, ativo && e.itemAtivo, pressed && { opacity: 0.85 }]}
                >
                  <Text style={e.emoji}>{EMOJI_VEICULO[v.tipo]}</Text>
                  <View style={e.itemTexto}>
                    <Text style={[e.placa, ativo && { color: colors.brandInk }]}>{v.rotulo}</Text>
                    <Text style={e.modelo} numberOfLines={1}>
                      {v.modelo}
                    </Text>
                    {/* Quem ja esta dentro, por extenso. E o que transforma a
                        escolha numa decisao informada em vez de um chute. */}
                    {v.ocupantes.length > 0 ? (
                      <Text style={e.ocupantes} numberOfLines={2}>
                        {v.ocupantes.map((o) => `${o.nome} (${o.papel})`).join(" · ")}
                      </Text>
                    ) : (
                      <Text style={e.livre}>Livre</Text>
                    )}
                  </View>
                  {ativo ? <Feather name="check-circle" size={20} color={colors.brand} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/*
          O bloco de detalhe fica FORA da rolagem, ancorado logo acima dos
          botoes.
          Ele ja esteve no fim da lista, e olhando a tela com a frota real (57
          viaturas) o defeito ficou obvio: escolher um carro revelava a pergunta
          "você vai como?" a dezenas de rolagens de distancia — ou seja, ninguem
          veria. Aqui a resposta aparece exatamente onde o olho ja esta, colada
          no "Confirmar" que vem a seguir.
        */}
        {veiculo ? (
          <View style={e.detalhe}>
            {/*
              A placa REPETIDA aqui, e nao so realcada na lista.
              Com a frota inteira rolando acima, o item selecionado fica fora da
              tela — e "Confirmar" sem dizer o que se confirma e a receita pra
              declarar o carro errado.
            */}
            <Text style={e.escolhido} numberOfLines={1}>
              <Text aria-hidden>{EMOJI_VEICULO[veiculo.tipo]} </Text>
              {veiculo.rotulo} · {veiculo.modelo}
            </Text>

            {/* A PERGUNTA: entrar junto ou assumir. */}
            <Text style={e.rotulo}>Você vai como</Text>
            <View style={e.linhaPapel}>
              {(["motorista", "passageiro"] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPapel(p)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: papel === p }}
                  style={({ pressed }) => [e.papel, papel === p && e.papelAtivo, pressed && { opacity: 0.85 }]}
                >
                  <Feather
                    name={p === "motorista" ? "navigation" : "users"}
                    size={14}
                    color={papel === p ? colors.onBrand : colors.ink2}
                  />
                  <Text style={[e.papelTxt, papel === p && { color: colors.onBrand }]}>
                    {p === "motorista" ? "Motorista" : "Vou com o colega"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/*
                  Aviso, e nao bloqueio. O servidor rebaixa para passageiro se
                  outro motorista ja estiver declarado (ha um indice parcial que
                  garante um so por viatura), entao prometer o volante aqui seria
                  prometer o que a rota vai recusar.
                */}
            {jaTemMotorista && papel === "motorista" ? (
              <View style={e.aviso}>
                <Feather name="info" size={13} color={colors.slaAmber} />
                <Text style={e.avisoTxt}>
                  Já há um motorista declarado nesta viatura. Você entrará como passageiro.
                </Text>
              </View>
            ) : null}

            {(colegas.data?.length ?? 0) > 0 ? (
              <>
                <Text style={e.rotulo}>Quem vai com você</Text>
                <View style={e.colegas}>
                  {colegas.data!.map((c) => {
                    const marcado = comigo.includes(c.id);
                    const nome = c.nomeExibicao || c.nome;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() =>
                          setComigo((atual) =>
                            atual.includes(c.id) ? atual.filter((x) => x !== c.id) : [...atual, c.id],
                          )
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: marcado }}
                        accessibilityLabel={nome}
                        style={({ pressed }) => [e.colega, marcado && e.colegaAtivo, pressed && { opacity: 0.85 }]}
                      >
                        {marcado ? <Feather name="check" size={13} color={colors.onBrand} /> : null}
                        <Text style={[e.colegaTxt, marcado && { color: colors.onBrand }]}>{nome}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={e.rodape}>
          {/*
            "Sem veículo" com o mesmo peso visual da confirmacao, e nao um link
            apagado: quem foi a pe nao pode ter de procurar a saida.
          */}
          <Button label={rotuloPular} variant="ghost" onPress={onSemVeiculo} disabled={ocupado} fullWidth />
          <Button
            label={ocupado ? "Registrando…" : "Confirmar"}
            onPress={confirmar}
            disabled={!veiculo || ocupado}
            loading={ocupado}
            fullWidth
          />
        </View>
      </View>
    </Modal>
  );
}

const e = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: "rgba(26,29,41,.45)" },
  folha: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xl,
    maxHeight: "85%",
  },
  puxador: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.line2,
    marginBottom: space.md,
  },
  titulo: {
    fontSize: font.size.xl,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: space.md,
  },
  rolagem: { flexGrow: 0 },
  rolagemInterna: { gap: space.sm, paddingBottom: space.md },
  centro: { paddingVertical: space.xl, alignItems: "center", gap: space.md },
  erro: { color: colors.muted, fontSize: font.size.base },

  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    // 64 de altura util: alvo de toque folgado pra quem esta em pe na rua.
    minHeight: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.cardAlt,
  },
  itemAtivo: { borderColor: colors.brand, backgroundColor: colors.brandBg },
  emoji: { fontSize: 24 },
  itemTexto: { flex: 1, gap: 2 },
  placa: {
    fontSize: font.size.lg,
    fontWeight: "700",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  modelo: { fontSize: font.size.sm, color: colors.ink2 },
  ocupantes: { fontSize: font.size.xs, color: colors.brandInk },
  livre: { fontSize: font.size.xs, color: colors.muted },

  detalhe: {
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  escolhido: { fontSize: font.size.base, fontWeight: "700", color: colors.brandInk, fontVariant: ["tabular-nums"] },
  rotulo: { fontSize: font.size.sm, fontWeight: "600", color: colors.ink2 },
  linhaPapel: { flexDirection: "row", gap: space.sm },
  papel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    minHeight: 44,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  papelAtivo: { backgroundColor: colors.brand, borderColor: colors.brand },
  papelTxt: { fontSize: font.size.sm, fontWeight: "600", color: colors.ink2 },

  aviso: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.slaAmberBg,
  },
  avisoTxt: { flex: 1, fontSize: font.size.xs, color: colors.slaAmber },

  colegas: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  colega: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  colegaAtivo: { backgroundColor: colors.brand, borderColor: colors.brand },
  colegaTxt: { fontSize: font.size.sm, fontWeight: "600", color: colors.ink2 },

  rodape: { gap: space.sm, paddingTop: space.md },
});
