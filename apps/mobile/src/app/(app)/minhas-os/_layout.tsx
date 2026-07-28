import { Stack } from "expo-router";
import { colors } from "@/theme/tokens";

/**
 * Stack do módulo minhas-os: a lista (index) e o detalhe ([id]) empilham dentro
 * da aba. Fundo claro em toda transição; o header fica escondido por padrão (a
 * lista tem título próprio) e o detalhe liga o seu via Stack.Screen.
 */
export default function MinhasOsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />;
}
