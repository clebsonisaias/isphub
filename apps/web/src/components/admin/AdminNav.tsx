import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Building2, Tags, Users, Blocks, MessageSquareText, Mail } from "lucide-react";

const ITEMS = [
  { to: "/admin", label: "Provedores", icon: Building2, match: (p: string) => p === "/admin" || p.startsWith("/admin/provedores") },
  { to: "/admin/categorias", label: "Categorias", icon: Tags, match: (p: string) => p.startsWith("/admin/categorias") },
  { to: "/admin/usuarios", label: "Usuários", icon: Users, match: (p: string) => p.startsWith("/admin/usuarios") },
  { to: "/admin/modulos", label: "Módulos", icon: Blocks, match: (p: string) => p.startsWith("/admin/modulos") },
  { to: "/admin/canais-whatsapp", label: "Canais WhatsApp", icon: MessageSquareText, match: (p: string) => p.startsWith("/admin/canais-whatsapp") },
  { to: "/admin/smtp", label: "E-mail", icon: Mail, match: (p: string) => p.startsWith("/admin/smtp") },
];

/**
 * Sub-navegação da área Administração.
 *
 * Rola na horizontal por necessidade, não por estilo: os itens somam bem mais
 * que a largura de um celular de 375px, e os últimos ("Módulos", "Canais
 * WhatsApp", "E-mail") ficavam FORA da tela — páginas de admin simplesmente
 * inacessíveis pelo celular, sem nem uma pista de que existiam.
 *
 * Rolar em vez de quebrar em duas linhas porque a linha do `border-b` é o que
 * amarra as abas visualmente; quebrada, ela parte no meio e o grupo deixa de
 * ler como uma faixa de abas.
 */
export function AdminNav() {
  const location = useLocation();
  const abaAtiva = useRef<HTMLAnchorElement | null>(null);

  /*
   * Traz a aba ativa pra dentro da vista. Sem isso, rolar resolvia metade do
   * problema e criava outra: chegando em /admin/modulos por link direto, o
   * celular mostrava Provedores/Categorias/Usuários com NENHUMA destacada — a
   * pessoa nao tinha como saber onde estava.
   *
   * `block: "nearest"` pra nao rolar a pagina inteira junto, so a faixa.
   */
  useEffect(() => {
    abaAtiva.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [location.pathname]);

  return (
    <div className="mb-6 border-b border-border">
      {/*
        `scrollbar-none` some com a barra (o toque arrasta, o trackpad rola),
        mas o item ativo pode nascer fora de vista quando se chega por link
        direto — `scroll-mx-3` + o scrollIntoView do foco dão conta no teclado,
        e o `snap` deixa o arraste parar alinhado.
      */}
      <nav
        aria-label="Seções da administração"
        className="-mb-px flex snap-x snap-mandatory gap-1 overflow-x-auto scrollbar-none"
      >
        {ITEMS.map(({ to, label, icon: Icon, match }) => {
          const ativo = match(location.pathname);
          return (
            <Link
              key={to}
              to={to}
              ref={ativo ? abaAtiva : undefined}
              aria-current={ativo ? "page" : undefined}
              className={cn(
                // `min-h-11`: alvo de toque de 44px — antes eram 36px de altura.
                "flex min-h-11 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                ativo
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
