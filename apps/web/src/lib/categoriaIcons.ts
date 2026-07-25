import {
  Plug,
  WifiOff,
  Wrench,
  Home,
  Router,
  XCircle,
  UserCheck,
  Tag,
  type LucideIcon,
} from "lucide-react";

/**
 * Conjunto curado de icones pra categorias — kebab-case (como salvo no banco,
 * `Categoria.icone`) -> componente lucide. Curto de proposito: cada categoria
 * escolhe entre um punhado de icones claros, nao o catalogo inteiro do lucide.
 */
export const CATEGORIA_ICONES: Record<string, LucideIcon> = {
  plug: Plug,
  "wifi-off": WifiOff,
  wrench: Wrench,
  home: Home,
  router: Router,
  "x-circle": XCircle,
  "user-check": UserCheck,
};

export const CATEGORIA_ICONE_OPCOES = Object.keys(CATEGORIA_ICONES);

/** Resolve o icone da categoria, com fallback pra um icone generico (Tag). */
export function iconeCategoria(nome?: string | null): LucideIcon {
  return (nome && CATEGORIA_ICONES[nome]) || Tag;
}
