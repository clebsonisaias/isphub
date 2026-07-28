import { Stack } from "expo-router";
import { colors } from "@/theme/tokens";

/**
 * Stack do modulo provisionamento: selecao (index) -> ONUs da OLT (onus) ->
 * form de autorizar (autorizar) empilham dentro da aba. Cada tela liga o seu
 * header via Stack.Screen; fundo claro em toda transicao.
 */
export default function ProvisionamentoLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />;
}
