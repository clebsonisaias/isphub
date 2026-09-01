import { useEffect, useState, type ComponentProps } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { checarBiometria, iconeBiometria, rotuloBiometria, type BiometriaInfo } from "@/lib/biometria";
import type { PreferenciaAcesso } from "@/lib/preferencia-acesso";
import { colors, font, radius, shadow, space } from "@/theme/tokens";

/**
 * "Quer entrar mais rapido da proxima vez?" — mostrada DEPOIS do primeiro
 * login, nunca antes.
 *
 * Antes de entrar, o tecnico esta tentando entrar; qualquer pergunta ali e
 * obstaculo e ele escolhe no escuro. Depois, o valor e concreto: ele acabou de
 * digitar e-mail e senha inteiros e sabe exatamente o que quer evitar amanha.
 *
 * Botoes e nao switches: switch pede leitura, botao pede toque. Sao tres
 * saidas de uma decisao so, nao tres decisoes.
 */
export function FolhaEscolhaAcesso({
  visivel,
  onEscolher,
}: {
  visivel: boolean;
  onEscolher: (p: PreferenciaAcesso) => void;
}) {
  const [bio, setBio] = useState<BiometriaInfo>({ disponivel: false, tipo: "generico" });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    checarBiometria().then(setBio).catch(() => {});
  }, []);

  return (
    <Modal visible={visivel} transparent animationType="slide" onRequestClose={() => onEscolher("nada")}>
      <View style={e.fundo}>
        {/*
          `paddingBottom` fixo escondia a ultima opcao atras da barra de
          navegacao do sistema — e a ultima e justamente "nao salvar nada", a
          que tem consequencia de privacidade. Some o inset real do aparelho.
        */}
        <View style={[e.folha, { paddingBottom: space.xxl + insets.bottom }]}>
          <Text style={e.titulo}>Quer entrar mais rápido da próxima vez?</Text>
          <Text style={e.sub}>Você pode mudar isso depois, no Perfil.</Text>

          <View style={e.opcoes}>
            {/*
              Some quando o aparelho nao tem digital cadastrada, em vez de
              aparecer desabilitada: opcao apagada obriga o tecnico a entender
              por que ela nao serve, e isso nao e problema dele.
            */}
            {bio.disponivel ? (
              <Opcao
                destaque
                icone={iconeBiometria(bio.tipo)}
                titulo={`Usar ${rotuloBiometria(bio.tipo)}`}
                descricao="Abre o app sem digitar nada."
                onPress={() => onEscolher("biometria")}
              />
            ) : null}
            <Opcao
              icone="mail"
              titulo="Só lembrar meu e-mail"
              descricao="Você digita a senha toda vez. Bom para aparelho compartilhado."
              onPress={() => onEscolher("email")}
            />
            <Opcao
              icone="shield-off"
              titulo="Não salvar nada neste aparelho"
              descricao="Fechou o app, saiu. Nada fica guardado aqui."
              onPress={() => onEscolher("nada")}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Opcao({
  icone,
  titulo,
  descricao,
  destaque,
  onPress,
}: {
  icone: ComponentProps<typeof Feather>["name"];
  titulo: string;
  descricao: string;
  destaque?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${titulo}. ${descricao}`}
      // Mesmo feedback do Button compartilhado: opacidade com escala.
      style={({ pressed }) => [e.opcao, destaque && e.opcaoDestaque, pressed && e.opcaoPress]}
    >
      <View style={[e.opcaoIcone, destaque && e.opcaoIconeDestaque]}>
        <Feather name={icone} size={18} color={destaque ? colors.onBrand : colors.brandInk} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[e.opcaoTitulo, destaque && { color: colors.onBrand }]}>{titulo}</Text>
        <Text style={[e.opcaoDesc, destaque && { color: colors.brandBg }]}>{descricao}</Text>
      </View>
    </Pressable>
  );
}


const e = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: "rgba(26,29,41,.45)", justifyContent: "flex-end" },
  folha: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.lg,
    gap: space.xs,
    ...shadow.lg,
  },
  titulo: { fontSize: font.size.xl, fontWeight: font.weight.bold as "700", color: colors.ink },
  sub: { fontSize: font.size.sm, color: colors.ink2 },
  opcoes: { gap: space.sm, marginTop: space.md },
  opcao: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    // Alvo confortavel: mao suja, sol, as vezes luva.
    minHeight: 64,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  opcaoDestaque: { backgroundColor: colors.brand, borderColor: colors.brand },
  opcaoPress: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  opcaoIcone: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandBg,
  },
  opcaoIconeDestaque: { backgroundColor: "rgba(255,255,255,.18)" },
  opcaoTitulo: { fontSize: font.size.base, fontWeight: font.weight.bold as "700", color: colors.ink },
  opcaoDesc: { fontSize: font.size.xs, color: colors.ink2, marginTop: 1 },
});
