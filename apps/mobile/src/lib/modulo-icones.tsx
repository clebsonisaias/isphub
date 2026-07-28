import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import type { ModuloId } from "@isphub/shared";

/**
 * Icone de cada modulo na tab bar. `icone` no catalogo (packages/shared) e
 * pensado pro admin (nomes lucide da tela web de modulos) — aqui mapeamos
 * pro equivalente mais proximo em Feather (mesma familia visual, traco fino,
 * combina com o "claro alto-contraste" do resto do app), caindo pra
 * MaterialCommunityIcons so nos 3 que a Feather nao tem (router/assinatura/
 * retirada). Nomes conferidos contra os glyphmaps reais — nao adivinhados.
 */
const ICONE_MODULO: Record<ModuloId, { familia: "feather" | "mci"; nome: string }> = {
  "minhas-os": { familia: "feather", nome: "list" },
  conexao: { familia: "feather", nome: "wifi" },
  provisionamento: { familia: "mci", nome: "router-wireless" },
  evidencias: { familia: "feather", nome: "camera" },
  rota: { familia: "feather", nome: "navigation" },
  notificacoes: { familia: "feather", nome: "bell" },
  assinatura: { familia: "mci", nome: "draw-pen" },
  retiradas: { familia: "mci", nome: "package-variant-remove" },
  chat: { familia: "feather", nome: "message-circle" },
};

export function ModuloIcon({ id, color, size }: { id: ModuloId; color: ColorValue; size: number }) {
  const icone = ICONE_MODULO[id];
  if (icone.familia === "mci") {
    return <MaterialCommunityIcons name={icone.nome as never} color={color} size={size} />;
  }
  return <Feather name={icone.nome as never} color={color} size={size} />;
}
