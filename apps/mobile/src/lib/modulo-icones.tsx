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
  "chat-clientes": { familia: "mci", nome: "whatsapp" },
  /*
   * Financeiro nao tem tela no app do tecnico (nao esta em ROTAS_MODULO, que e
   * `Partial`, entao nunca vira aba). A entrada existe so porque este mapa e um
   * `Record` COMPLETO — e e bom que seja: se um dia o modulo ganhar tela
   * mobile, o typecheck ja cobrou o icone em vez de quebrar em runtime.
   */
  financeiro: { familia: "mci", nome: "wallet-outline" },
  /* Mesma situacao do financeiro: sem tela no app (fora de ROTAS_MODULO). O
   * tecnico declara a viatura DENTRO da jornada, que ja e core. */
  frota: { familia: "mci", nome: "truck-outline" },
};

export function ModuloIcon({ id, color, size }: { id: ModuloId; color: ColorValue; size: number }) {
  const icone = ICONE_MODULO[id];
  if (icone.familia === "mci") {
    return <MaterialCommunityIcons name={icone.nome as never} color={color} size={size} />;
  }
  return <Feather name={icone.nome as never} color={color} size={size} />;
}
