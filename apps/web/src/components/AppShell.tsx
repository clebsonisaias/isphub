import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { USER_ROLE_LABEL, UserRole, type ModuloId } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useModulosHabilitados } from "@/lib/modulos";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NotificationBell } from "@/components/NotificationBell";
import { CommandPalette } from "@/components/CommandPalette";
import { HeaderClock } from "@/components/HeaderClock";
import { chatApi } from "@/lib/chatApi";
import { useRealtime } from "@/lib/realtime";
import { cn, iniciais } from "@/lib/utils";
import { APP_BUILD_ID, APP_VERSION_LABEL } from "@/lib/version";
import {
  LogOut,
  Map,
  LayoutGrid,
  BarChart3,
  Settings,
  PackageX,
  Router,
  UserCircle,
  Sun,
  Moon,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
} from "lucide-react";

const INTERVALO_POLLING_NAO_LIDAS_MS = 45_000;

/**
 * Dashboard e Retiradas sao so pra quem enxerga mais de uma OS/provedor —
 * tecnico ve so as proprias. `modulo`, quando presente, soma um segundo
 * filtro: o item so aparece se esse modulo estiver habilitado pro usuario
 * (ver useModulosHabilitados) — sem isto, um modulo desligado por padrao
 * (ex.: chat-clientes) vira link morto na nav pra todo mundo.
 */
/**
 * `labelCurto` e so pro rodape do mobile: com sete abas em 375px cada uma fica
 * com ~53px, e "Provisionar"/"Administração" preenchiam a fatia inteira — os
 * rotulos vizinhos se encostavam e liam como uma palavra so. O nome COMPLETO
 * continua no `aria-label` e volta a aparecer no desktop, entao nada muda pro
 * leitor de tela nem pra arvore de acessibilidade.
 */
const NAV_ITEMS: {
  to: string;
  label: string;
  labelCurto?: string;
  icon: typeof LayoutGrid;
  ocultoPara: UserRole[];
  modulo?: ModuloId;
}[] = [
  { to: "/", label: "Painel", icon: LayoutGrid, ocultoPara: [] },
  { to: "/mapa", label: "Mapa", icon: Map, ocultoPara: [] },
  {
    to: "/chat",
    label: "Chat",
    icon: MessageCircle,
    ocultoPara: [UserRole.PROVEDOR],
    modulo: "chat",
  },
  {
    to: "/chat-clientes",
    label: "Clientes",
    icon: MessageSquareText,
    ocultoPara: [UserRole.PROVEDOR],
    modulo: "chat-clientes",
  },
  // Retirada e feita por equipe de fora — tecnico da ISPhub nunca executa
  // uma, a tela seria sempre vazia pra ele.
  {
    to: "/retiradas",
    label: "Retiradas",
    icon: PackageX,
    ocultoPara: [UserRole.TECNICO],
  },
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: BarChart3,
    ocultoPara: [UserRole.TECNICO],
  },
  // Provisionar ONU (FTTX): técnico faz pelo app; na web é ferramenta de admin/gestor/provedor.
  {
    to: "/provisionamento",
    label: "Provisionar",
    labelCurto: "ONU",
    icon: Router,
    ocultoPara: [UserRole.TECNICO],
  },
];

/** Largura reservada pro botao "Mais" quando ha excesso (medida do proprio botao). */
const LARGURA_BOTAO_MAIS = 86;
/** `lg:gap-1` do nav. */
const GAP_NAV = 4;

/**
 * Quantos itens de navegacao cabem na linha do cabecalho.
 *
 * A quantidade de itens VARIA — modulos ligam e desligam, e o papel do usuario
 * esconde alguns. Calibrar o cabecalho pra um numero fixo e o que fez a
 * navegacao quebrar de novo: com 7 itens cabia, com 8 (modulo de chat de
 * clientes ligado) "Administração" virava "Ad". Aqui a conta e feita com a
 * largura real, entao vale pra qualquer quantidade.
 *
 * As larguras sao medidas UMA vez, com todos os itens visiveis, e guardadas —
 * depois de esconder um item nao da mais pra medi-lo. Os rotulos sao estaticos,
 * entao a medida continua valendo; se a lista mudar, o cache e descartado.
 */
function useQuantosCabem(qtdItens: number, navRef: React.RefObject<HTMLElement | null>) {
  const [cabem, setCabem] = useState(qtdItens);
  const largurasRef = useRef<number[] | null>(null);

  const recalcular = useCallback(() => {
    const el = navRef.current;
    if (!el) return;

    // Abaixo de `lg` o nav e a barra fixa do rodape, com layout proprio —
    // nada de esconder item ali.
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      setCabem(qtdItens);
      return;
    }

    if (!largurasRef.current) {
      const itens = [...el.querySelectorAll<HTMLElement>("[data-nav-item]")];
      const medidas = itens.map((i) => i.offsetWidth);
      /*
       * So aceita a medida quando TODOS os itens tem largura real.
       *
       * Um item escondido mede ZERO, e zero na conta faz o total encolher — o
       * calculo conclui "cabe tudo", expande, mede certo, colapsa de novo, e
       * fica oscilando. Contar os elementos nao bastava: eles EXISTEM no DOM
       * mesmo colapsados (o colapso e `display:none` via CSS), so nao tem
       * largura. Medida invalida: sai sem gravar e tenta no proximo quadro.
       */
      if (medidas.length < qtdItens || medidas.some((w) => w === 0)) return;
      largurasRef.current = medidas;
    }

    const larguras = largurasRef.current;
    const disponivel = el.clientWidth;
    const total = larguras.reduce((a, b) => a + b, 0) + GAP_NAV * (larguras.length - 1);
    if (total <= disponivel) {
      setCabem(qtdItens);
      return;
    }

    let usado = LARGURA_BOTAO_MAIS + GAP_NAV;
    let n = 0;
    for (const w of larguras) {
      if (usado + w > disponivel) break;
      usado += w + GAP_NAV;
      n++;
    }
    // Pelo menos um item na linha — um cabecalho so com "Mais" nao ajuda.
    setCabem(Math.max(1, n));
  }, [qtdItens, navRef]);

  // Lista mudou (modulo ligado/desligado, troca de papel): remede do zero.
  useLayoutEffect(() => {
    largurasRef.current = null;
    setCabem(qtdItens);
  }, [qtdItens]);

  /*
   * `useLayoutEffect` roda depois do DOM e ANTES da pintura: mede com tudo na
   * tela e ja aplica o colapso no MESMO quadro. Em `useEffect` (depois da
   * pintura) os itens excedentes apareciam por um instante e sumiam — um pisca
   * visivel pra quem usa, e uma corrida que fazia o teste ler a linha antes de
   * ela assentar.
   */
  useLayoutEffect(recalcular);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ro = new ResizeObserver(recalcular);
    ro.observe(nav);
    // A fonte de display carrega depois do primeiro quadro e muda a largura
    // dos rotulos; sem isto a medida inicial fica errada por pouco.
    /*
     * Fonte carregada: descarta a medida e EXPANDE. Expandir e obrigatorio —
     * com itens escondidos a remedicao seria invalida (largura zero) e o cache
     * ficaria vazio pra sempre. Com todos visiveis, o `useLayoutEffect` do
     * proximo render mede certo e recolapsa antes da pintura.
     */
    void document.fonts?.ready.then(() => {
      largurasRef.current = null;
      setCabem(qtdItens);
    });
    return () => ro.disconnect();
  }, [recalcular, navRef]);

  return cabem;
}

/**
 * Classe de um item de navegacao — um unico elemento serve dois papeis pelo
 * breakpoint `lg`: aba de rodape (mobile/tablet, alcance de polegar) e pilula
 * no cabecalho (desktop). Nunca existem os dois ao mesmo tempo (nao ha
 * duplicacao de Link/nome acessivel — so uma troca de layout via CSS), entao
 * o rotulo "Administração" continua unico na arvore de acessibilidade em
 * qualquer largura, do jeito que os testes e2e esperam.
 */
function navItemClass(ativo: boolean): string {
  return cn(
    // `lg:shrink-0` + `whitespace-nowrap`: agora que o nav rola (ver a nota no
    // <nav>), a pilula nao pode ser comprimida nem quebrar o rotulo em duas
    // linhas — ela sai de vista rolando, inteira, e volta do mesmo jeito.
    "group relative flex flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-1 py-2 text-[0.65rem] font-medium transition-colors lg:flex-none lg:shrink-0 lg:flex-row lg:gap-1.5 lg:rounded-full lg:px-3 lg:py-1.5 lg:text-sm pointer-coarse:min-h-11",
    ativo
      ? "text-primary"
      : "text-muted-foreground hover:text-foreground lg:hover:bg-secondary/60",
  );
}

/**
 * Pilula de fundo do item de rota ativo no desktop — um unico elemento com
 * `layoutId` compartilhado entre os Links (motor de layout do Framer Motion
 * ve a posicao/tamanho mudar entre renders com IDs iguais e anima a
 * transicao), entao ela DESLIZA pra pilula seguinte em vez de piscar. So no
 * desktop (`hidden lg:block`) — no mobile o destaque já vem do icone-chip do
 * NavIcon, que não precisa de deslizamento (abas fixas, sem espaço de sobra).
 */
function NavActivePill({
  shouldReduceMotion,
}: {
  shouldReduceMotion: boolean;
}) {
  return (
    <motion.span
      aria-hidden
      layoutId="nav-active-pill"
      className="absolute inset-0 hidden rounded-full bg-primary/12 lg:block"
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 500, damping: 34 }
      }
    />
  );
}

function NavIcon({
  Icon,
  ativo,
  badge,
}: {
  Icon: typeof LayoutGrid;
  ativo: boolean;
  badge?: number;
}) {
  return (
    <span
      className={cn(
        "relative flex size-7 items-center justify-center rounded-lg transition-colors lg:size-auto lg:rounded-none lg:bg-transparent",
        ativo && "bg-primary/12 lg:bg-transparent",
      )}
    >
      <Icon className="size-[1.15rem] shrink-0 lg:size-4" />
      {!!badge && (
        <span className="absolute -right-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent-yellow px-1 text-[0.6rem] font-bold leading-4 text-accent-yellow-foreground lg:-right-2 lg:-top-2">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </span>
  );
}

/**
 * Menu do usuario (avatar) em popover — Perfil/Tema/Sair. Antes "Meu perfil"
 * ficava `hidden lg:flex` (sumia inteiro no mobile) e tema/sair eram botoes
 * soltos no cabecalho; agora e uma UNICA affordance, visivel em qualquer
 * largura — mais descobrivel no mobile e menos poluicao de icones no header.
 */
function UserMenu({
  nome,
  role,
  onLogout,
}: {
  nome: string;
  role: UserRole;
  onLogout: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${nome} — ${USER_ROLE_LABEL[role]}`}
          /*
           * Rotulo explicito: abaixo de `xl` o nome fica escondido e sobram so
           * as INICIAIS, entao o leitor de tela anunciava "EA, botao". Quem usa
           * o app no celular — a maior parte dos tecnicos — nao tinha como
           * saber o que esse botao abre.
           */
          aria-label={`Menu do usuário — ${nome}`}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 outline-none transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring lg:pr-2.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-secondary font-display text-xs font-semibold text-foreground">
            {iniciais(nome)}
          </span>
          <span className="hidden text-left leading-tight xl:block">
            <span className="block text-sm font-medium text-foreground">
              {nome}
            </span>
            <span className="block text-xs text-muted-foreground">
              {USER_ROLE_LABEL[role]}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5">
        <div className="border-b border-border px-2.5 pb-2 pt-1 lg:hidden">
          <p className="truncate text-sm font-medium text-foreground">{nome}</p>
          <p className="text-xs text-muted-foreground">
            {USER_ROLE_LABEL[role]}
          </p>
        </div>
        {/*
          Hora de REDE (do servidor, nao do aparelho) — importa pra discussao
          de SLA, onde o relogio do computador de cada um nao serve de prova.
          Vive aqui porque na linha do cabecalho ele competia com a navegacao e
          ganhava; aqui cabe inteiro e aparece em qualquer largura, inclusive
          no celular, onde antes nunca era exibido.
        */}
        <div className="border-b border-border px-2.5 pb-2 pt-1.5">
          <HeaderClock />
        </div>
        <Link
          to="/perfil"
          onClick={() => setAberto(false)}
          className="mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
        >
          <UserCircle className="size-4 text-muted-foreground" />
          Meu perfil
        </Link>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
        >
          {theme === "dark" ? (
            <Sun className="size-4 text-muted-foreground" />
          ) : (
            <Moon className="size-4 text-muted-foreground" />
          )}
          {theme === "dark" ? "Tema claro" : "Tema escuro"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAberto(false);
            onLogout();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-destructive pointer-coarse:min-h-11"
        >
          <LogOut className="size-4" />
          Sair
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Mais" — os itens de navegacao que nao couberam na linha.
 *
 * So existe no desktop (`hidden lg:flex`): abaixo de `lg` a navegacao e a
 * barra fixa do rodape e TODOS os itens aparecem la. Nao ha duplicacao de link
 * na arvore de acessibilidade — o Popover do Radix so monta o conteudo quando
 * aberto, e um item que esta aqui esta escondido da linha (`lg:hidden`).
 */
function NavExcesso({
  itens,
  caminhoAtual,
  naoLidasChat,
}: {
  itens: { to: string; label: string; icon: typeof LayoutGrid }[];
  caminhoAtual: string;
  naoLidasChat: number;
}) {
  const [aberto, setAberto] = useState(false);
  // Se a pagina ATUAL esta escondida aqui dentro, o botao precisa dizer isso —
  // senao a navegacao nao mostra onde a pessoa esta.
  const contemAtual = itens.some((i) =>
    i.to === "/admin" ? caminhoAtual.startsWith("/admin") : caminhoAtual === i.to,
  );

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Mais seções (${itens.length})`}
          className={cn(
            // `pointer-coarse:min-h-11` como os demais itens: em tablet
            // paisagem (1024px COM toque) o botao ficava 76x32px, abaixo do
            // minimo de 44px.
            "hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors lg:flex pointer-coarse:min-h-11",
            contemAtual
              ? "bg-primary/12 text-foreground"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          <MoreHorizontal className="size-4 shrink-0" />
          Mais
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1.5">
        {itens.map(({ to, label, icon: Icon }) => {
          const ativo = to === "/admin" ? caminhoAtual.startsWith("/admin") : caminhoAtual === to;
          return (
            <Link
              key={to}
              to={to}
              onClick={() => setAberto(false)}
              aria-current={ativo ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
                ativo ? "bg-primary/12 font-medium text-foreground" : "text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              {label}
              {to === "/chat" && naoLidasChat > 0 && (
                <span className="ml-auto rounded-full bg-accent-yellow px-1.5 text-[0.65rem] font-bold text-accent-yellow-foreground">
                  {naoLidasChat > 9 ? "9+" : naoLidasChat}
                </span>
              )}
            </Link>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/** Casca comum das telas autenticadas: cabecalho com marca, navegação, usuario e logout. */
export function AppShell({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const [naoLidasChat, setNaoLidasChat] = useState(0);
  const { ids: modulosHabilitados } = useModulosHabilitados();
  const navRef = useRef<HTMLElement | null>(null);

  /*
   * UMA lista com tudo, inclusive Administração — que antes era renderizada
   * solta depois do map. Unificar e o que permite a conta de excesso tratar
   * todos os itens igual; solto, ele seria sempre o que sobra pra fora (foi
   * exatamente ele que apareceu cortado como "Ad").
   */
  const itensNav = useMemo(() => {
    const base = NAV_ITEMS.filter(
      (item) =>
        !!usuario &&
        !item.ocultoPara.includes(usuario.role) &&
        (!item.modulo || modulosHabilitados.has(item.modulo)),
    );
    if (usuario?.role === UserRole.ADMIN) {
      base.push({
        to: "/admin",
        label: "Administração",
        labelCurto: "Admin",
        icon: Settings,
        ocultoPara: [],
      });
    }
    return base;
  }, [usuario, modulosHabilitados]);

  const cabem = useQuantosCabem(itensNav.length, navRef);
  const noExcesso = itensNav.slice(cabem);

  useEffect(() => {
    if (!usuario || usuario.role === UserRole.PROVEDOR) return;
    async function atualizar() {
      try {
        const { naoLidas } = await chatApi.naoLidas();
        setNaoLidasChat(naoLidas);
      } catch {
        // sino do chat nao deve interromper a navegacao por causa de polling
      }
    }
    void atualizar();
    const t = setInterval(
      () => void atualizar(),
      INTERVALO_POLLING_NAO_LIDAS_MS,
    );
    return () => clearInterval(t);
  }, [usuario]);

  useRealtime((evento) => {
    if (evento.tipo === "chat-mensagem" || evento.tipo === "chat-leitura") {
      chatApi
        .naoLidas()
        .then(({ naoLidas }) => setNaoLidasChat(naoLidas))
        .catch(() => {});
    }
  });

  return (
    <div className="min-h-svh">
      {/*
        Sem backdrop-blur AQUI de proposito: `backdrop-filter` num ancestral
        cria containing block pra descendentes `position: fixed` (CSS
        Transforms spec) — a nav abaixo é fixa no rodape no mobile, e um
        header com blur faria ela "grudar" no fim do header (perto do topo)
        em vez do fim da viewport de verdade. O blur fica só na propria nav.
      */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95">
        {/* Fio de marca — um unico detalhe de cor no cabecalho, discreto. */}
        <div
          aria-hidden
          className="h-[2px] w-full brand-gradient-bg opacity-70"
        />
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-4 lg:gap-2">
          <Link to="/" className="flex shrink-0 items-center gap-2 pointer-coarse:min-h-11">
            <span className="font-display text-lg font-bold tracking-tight">
              <span className="brand-gradient-text">ISP</span>
              <span className="text-foreground">hub</span>
            </span>
            <span
              className="hidden rounded-full border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[0.6rem] font-medium tabular-nums text-muted-foreground xl:inline"
              title={APP_BUILD_ID ? `Build ${APP_BUILD_ID}` : undefined}
            >
              {APP_VERSION_LABEL}
            </span>
          </Link>

          {/*
            Navegacao unica: aba fixa no rodape abaixo de `lg` (alcance de
            polegar pro tecnico em campo no celular), pilulas no proprio
            cabecalho a partir de `lg`. `position: fixed` tira o elemento do
            fluxo do header no mobile sem precisar de outro componente —
            `lg:static` devolve ao fluxo normal da linha no desktop.
          */}
          {usuario && (
            <nav
              ref={navRef}
              /*
               * `lg:min-w-0` + `lg:overflow-x-auto` no desktop: com `flex-1`
               * sozinho o nav nunca encolhia abaixo do seu min-content, e as
               * pilulas (cujo numero varia — modulos ligam e desligam)
               * empurravam o grupo da direita PARA FORA da tela. Medido a
               * 1440px: busca, notificacoes e menu do usuario ficavam 111px
               * alem da borda, com a pagina rolando na horizontal.
               *
               * Com `min-w-0` o nav cede espaco e, se ainda faltar, rola dentro
               * de si — nada sai da tela e os controles da direita ficam
               * sempre no lugar.
               */
              className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:static lg:inset-auto lg:z-auto lg:min-w-0 lg:flex-1 lg:items-center lg:justify-start lg:gap-1 lg:overflow-x-auto lg:border-t-0 lg:bg-transparent lg:pb-0 lg:backdrop-blur-none lg:scrollbar-none"
              aria-label="Navegação principal"
            >
              {itensNav.map(({ to, label, labelCurto, icon: Icon }, i) => {
                const ativo = to === "/admin" ? location.pathname.startsWith("/admin") : location.pathname === to;
                const soNoExcesso = i >= cabem;
                return (
                  <Link
                    key={to}
                    to={to}
                    title={label}
                    data-nav-item
                    // Nome acessivel e sempre o completo, mesmo quando o rotulo
                    // visivel esta abreviado no rodape.
                    aria-label={labelCurto ? label : undefined}
                    /*
                     * `lg:hidden` quando nao coube: some da LINHA e reaparece
                     * dentro de "Mais". Abaixo de `lg` continua visivel — ali o
                     * nav e a barra do rodape, com layout proprio.
                     */
                    className={cn(navItemClass(ativo), soNoExcesso && "lg:hidden")}
                  >
                    {ativo && (
                      <NavActivePill
                        shouldReduceMotion={!!shouldReduceMotion}
                      />
                    )}
                    <NavIcon
                      Icon={Icon}
                      ativo={ativo}
                      badge={to === "/chat" ? naoLidasChat : undefined}
                    />
                    {/* Abreviado abaixo de `lg`, completo a partir dali. */}
                    <span className="relative lg:hidden">{labelCurto ?? label}</span>
                    <span className="relative hidden lg:inline">{label}</span>
                  </Link>
                );
              })}
              {noExcesso.length > 0 && (
                <NavExcesso
                  itens={noExcesso}
                  caminhoAtual={location.pathname}
                  naoLidasChat={naoLidasChat}
                />
              )}
            </nav>
          )}

          {/*
            O relogio de rede SAIU daqui (foi pro menu do usuario). Ele
            aparecia em 1536px e consumia 291px de uma barra travada em 1280px,
            empurrando 275px de navegacao pra fora — com a barra de rolagem
            escondida, sem nenhuma pista de que os itens existiam. Medido: a
            partir de 1536px o nav caia de 780px pra 490px.
          */}
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            {usuario && <CommandPalette />}
            {usuario && <NotificationBell />}
            {usuario && (
              <UserMenu
                nome={usuario.nome}
                role={usuario.role}
                onLogout={logout}
              />
            )}
          </div>
        </div>
      </header>

      {/* pb extra no mobile: a aba de navegacao fixa no rodape nao pode
          cobrir o final da lista/conteudo. */}
      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 lg:pb-6">
        {children}
      </main>

      <footer className="mx-auto hidden max-w-7xl items-center justify-between px-4 py-4 text-xs text-muted-foreground lg:flex">
        <span>
          <span className="brand-gradient-text font-semibold">ISPhub</span> —
          central de campo multi-provedor
        </span>
        <span
          className="font-mono tabular-nums"
          title={APP_BUILD_ID ? `Build ${APP_BUILD_ID}` : undefined}
        >
          {APP_VERSION_LABEL}
        </span>
      </footer>
    </div>
  );
}
