import { Component, type ErrorInfo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { colors, font, space } from "@/theme/tokens";

/**
 * Rede de seguranca de render do app.
 *
 * Sem isto, qualquer excecao durante o render derrubava o app pra tela branca,
 * sem nada na interface e sem caminho de volta — no meio de um atendimento, com
 * o tecnico na casa do cliente. Aqui ele ao menos ve o que houve e consegue
 * tentar de novo sem fechar e reabrir o app.
 *
 * Precisa ser classe: nao existe equivalente em hook pra componentDidCatch.
 */
interface Props {
  children: ReactNode;
}

interface State {
  erro: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error("[isphub] erro de render:", erro, info.componentStack);
  }

  private tentarDeNovo = () => this.setState({ erro: null });

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <View style={styles.wrap}>
        <Text style={styles.titulo}>Algo deu errado</Text>
        <Text style={styles.texto}>
          O app encontrou um erro inesperado nesta tela. Seus dados nao foram perdidos — as acoes
          pendentes sobem quando a tela voltar.
        </Text>
        <Text style={styles.detalhe} numberOfLines={3}>
          {erro.message}
        </Text>
        <View style={styles.botao}>
          <Button label="Tentar de novo" onPress={this.tentarDeNovo} />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.ground, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md },
  titulo: { fontSize: font.size.xl, fontWeight: "700", color: colors.ink },
  texto: { fontSize: font.size.base, color: colors.ink2, textAlign: "center" },
  detalhe: { fontSize: font.size.xs, color: colors.muted, textAlign: "center" },
  botao: { alignSelf: "stretch", marginTop: space.md },
});
