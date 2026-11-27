import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { USER_ROLE_LABEL, UserRole, escopadoPorProvedor, podeRotaWeb, type ModuloId } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useModulosHabilitados } from "@/lib/modulos";
import { fixosRodapeDoPapel, inicioDoPapel, ordenarPorPapel } from "@/lib/inicioPorPapel";
import { agruparMenu, rotaAtiva } from "@/lib/menuLateral";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NotificationBell } from "@/components/NotificationBell";
import { CommandPalette } from "@/components/CommandPalette";
import { HeaderClock } from "@/components/HeaderClock";
import { SyncBanner } from "@/components/SyncBanner";
import { MeuDesempenhoDialog } from "@/components/MeuDesempenhoDialog";
import { RotaDoDiaModal } from "@/components/tecnico/RotaDoDiaModal";
import { chatApi } from "@/lib/chatApi";
import { useRealtime } from "@/lib/realtime";
import { cn, iniciais } from "@/lib/utils";
import { APP_BUILD_ID, APP_VERSION_LABEL } from "@/lib/version";
import {
  LogOut,
  Map,
  LayoutGrid,
  BarChart3,
  Gauge,
  Settings,
  PackageX,
  PhoneMissed,
  Router,
  UserCircle,
  Sun,
  Moon,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  Wallet,
  Trophy,
  Truck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  UserPlus,
  Route,
  Users,
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
 * continua como TEXTO do link (num span so pra leitor de tela), entao nada
 * muda pra arvore de acessibilidade. Nao e `aria-label` de proposito: os
 * seletores `getByLabel('Número'|'Dia'|'De')` dos formularios casavam, por
 * substring, com "Frota em números", "Escala do dia" e "Agenda de visitas"
 * — oito e2e de financeiro e frota caiam em modo estrito por causa da nav.
 */
/**
 * `soDesktop` tira o item da ABA FIXA do rodape (mas nao da navegacao): a mesma
 * <nav> serve os dois papeis, entao cada item novo estreita todas as abas em
 * 375px. Medido com nove: os alvos caiam pra 36-40px, abaixo do piso de 40 que
 * a auditoria de responsividade cobra — dedo em campo erraria o toque.
 *
 * Quem leva a marca some da barra do polegar e reaparece no menu do usuario
 * (ver `itensSoDesktop` em UserMenu), que e onde destino de baixa frequencia
 * pertence. So marque assim o que ninguem usa de pe, na rua.
 */
const NAV_ITEMS: {
  to: string;
  label: string;
  labelCurto?: string;
  icon: typeof LayoutGrid;
  ocultoPara: UserRole[];
  modulo?: ModuloId;
  soDesktop?: boolean;
}[] = [
  { to: "/", label: "Painel", icon: LayoutGrid, ocultoPara: [] },
  { to: "/despacho", label: "Despacho", icon: Route, ocultoPara: [UserRole.PROVEDOR, UserRole.TECNICO] },
  {
    to: "/marcar-visita",
    label: "Marcar visita",
    labelCurto: "Marcar",
    icon: CalendarPlus,
    ocultoPara: [UserRole.PROVEDOR, UserRole.TECNICO],
  },
  // Vendedor: "Meu mes" (producao com meta e conquistas) so existe pra ele.
  {
    to: "/producao",
    label: "Meu mês",
    labelCurto: "Meu mês",
    icon: Trophy,
    ocultoPara: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO, UserRole.PROVEDOR, UserRole.ATENDENTE],
  },
  // Vendedor: o perfil (foto, senha, telefone) vira aba da barra — os outros papeis o abrem pelo menu do avatar.
  {
    to: "/perfil",
    label: "Meu perfil",
    labelCurto: "Perfil",
    icon: UserCircle,
    ocultoPara: [UserRole.ADMIN, UserRole.GESTOR, UserRole.TECNICO, UserRole.PROVEDOR, UserRole.ATENDENTE],
  },
  {
    to: "/pre-cadastro",
    label: "Pré-cadastro",
    labelCurto: "Vender",
    icon: UserPlus,
    ocultoPara: [UserRole.PROVEDOR, UserRole.TECNICO, UserRole.ATENDENTE],
  },
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
  // OS pendente nao tem tecnico (a API desvincula): a tela seria sempre vazia pro tecnico.
  {
    to: "/pendentes",
    label: "Pendentes",
    icon: PhoneMissed,
    ocultoPara: [UserRole.TECNICO],
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
  /*
   * Produtividade da equipe. PROVEDOR nao ve: a equipe e da HubISP, e o
   * desempenho dela nao e informacao de cliente. TECNICO tambem nao — ver a
   * rota em App.tsx.
   */
  {
    to: "/produtividade",
    label: "Produtividade",
    // "Produção", não "Equipe": "Equipe" agora é o cadastro da equipe do supervisor (/equipe).
    labelCurto: "Produção",
    icon: Trophy,
    ocultoPara: [UserRole.PROVEDOR, UserRole.TECNICO],
  },
  /*
   * Frota. PROVEDOR fica de fora: a posicao de uma viatura conta a um ISP
   * quando o concorrente foi atendido — e ha carro da operacao, que nao e de
   * ninguem em particular. TECNICO tambem: ele declara a viatura DENTRO da
   * jornada, no app; uma lista de cadastro na web nao serve pra ele.
   */
  /*
   * Escala do dia. Item proprio e nao um botao dentro de "Frota": quem abre
   * Frota quer saber quais viaturas existem; quem abre isto quer decidir quem
   * sai em qual, hoje, antes das 7h. Escondida atras de um link interno, a
   * segunda pergunta simplesmente nao seria encontrada.
   */
  /*
   * Agenda de visitas — a planilha de agendamento de OS que a operacao mantinha
   * no Drive. Item proprio, e ANTES da Escala: primeiro se decide em que dia a
   * visita cabe, depois quem sai em qual carro pra faze-la.
   */
  {
    to: "/agenda",
    label: "Agenda de visitas",
    labelCurto: "Agenda",
    icon: CalendarDays,
    ocultoPara: [UserRole.PROVEDOR, UserRole.TECNICO],
  },
  {
    to: "/escala",
    label: "Escala do dia",
    labelCurto: "Escala",
    icon: CalendarClock,
    ocultoPara: [UserRole.PROVEDOR, UserRole.TECNICO],
    modulo: "frota",
  },
  {
    to: "/frota",
    label: "Frota",
    icon: Truck,
    ocultoPara: [UserRole.PROVEDOR, UserRole.TECNICO],
    modulo: "frota",
  },
  /*
   * O BI e item PROPRIO e nao um botao dentro de /frota: quem abre "Frota"
   * quer saber onde a viatura esta agora; quem abre isto quer saber quanto ela
   * custou no trimestre. Duas perguntas, dois destinos — escondido atras de um
   * link interno, o segundo simplesmente nao seria encontrado.
   */
  {
    to: "/frota/bi",
    label: "Frota em números",
    labelCurto: "Números",
    // `Gauge` e nao `BarChart3`: o Dashboard ja usa BarChart3, e dois itens do
    // mesmo menu com o mesmo icone anulam o icone como pista.
    icon: Gauge,
    ocultoPara: [UserRole.PROVEDOR, UserRole.TECNICO],
    modulo: "frota",
  },
  // Equipe: o supervisor cadastra tecnico, atendente e vendedor. O admin tem /admin/usuarios.
  {
    to: "/equipe",
    label: "Equipe",
    icon: Users,
    ocultoPara: [UserRole.ADMIN, UserRole.PROVEDOR, UserRole.TECNICO],
  },
  /*
   * Dinheiro da PROPRIA HubISP. Escondido de todo mundo menos ADMIN, e nao so
   * pelo modulo: `rolesPermitidos` e configuravel em /admin/modulos, e um
   * PROVEDOR adicionado ali por engano veria o preco combinado com os
   * concorrentes dele. A rota da API recusa de qualquer jeito — isto aqui e a
   * primeira das tres camadas, nao a unica.
   */
  {
    to: "/financeiro",
    label: "Financeiro",
    // Sem `labelCurto`: "R$" ao lado de "Painel" e "Dashboard" nao diz o que
    // e. "ONU" funciona porque e termo do dominio; simbolo de moeda nao. Com
    // 10 caracteres ele cabe na mesma faixa de "Retiradas"/"Dashboard", e se um
    // dia nao couber, o menu de excesso ja resolve — que e pra isso que ele existe.
    icon: Wallet,
    ocultoPara: [UserRole.PROVEDOR, UserRole.TECNICO, UserRole.GESTOR],
    modulo: "financeiro",
    // Back-office: ninguem lanca conta a pagar de pe, na rua. Fora da barra do
    // polegar (que e a ferramenta de campo), presente no menu do usuario.
    soDesktop: true,
  },
];

/**
 * O que a atendente ve na barra: lista de permissao, nao de exclusao. Pendentes
 * entra: e ela quem remarca quando o cliente sem retorno finalmente responde.
 */
const NAV_ATENDENTE = new Set(["/", "/marcar-visita", "/agenda", "/pendentes"]);
/** Vendedor: so o pre-cadastro (a API fecha o resto pra ele). */
/**
 * Vendedor: pre-cadastro, os dois chats e o perfil. A tela dele e fixa pelo
 * papel, entao nao depende do liga/desliga de modulos (feito para a equipe).
 */
const NAV_VENDEDOR = new Set(["/pre-cadastro", "/producao", "/chat-clientes", "/chat", "/perfil"]);

/**
 * As abas FIXAS da barra do rodape no celular vem de `fixosRodapeDoPapel`
 * (lib/inicioPorPapel.ts), em ordem de preferencia: ficam as 4 primeiras que o
 * perfil enxerga, e o resto vai pro "Mais" do rodape. Gestor: Despacho, Painel,
 * Agenda, Mapa. Atendente: Marcar visita, Agenda, Painel.
 *
 * Com 13 abas (admin) a barra rolava de lado: resolvia o estouro, mas ninguem
 * descobre a 10a aba rolando. Quatro fixas + "Mais" e o padrao de app.
 */
const MAX_ABAS_RODAPE = 5;

function MenuLateral({
  itens,
  caminhoAtual,
  naoLidasChat,
  inicio,
  nome,
  papel,
}: {
  itens: { to: string; label: string; icon: typeof LayoutGrid }[];
  caminhoAtual: string;
  naoLidasChat: number;
  inicio: string;
  nome: string;
  papel: UserRole;
}) {
  return (
    <aside className="sticky top-0 hidden h-svh w-58 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-[0.8125rem] text-sidebar-foreground lg:flex">
      <Link
        to={inicio}
        className="flex items-center gap-2.5 px-5 pb-3 pt-4.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <LogoIsphub className="size-7 shrink-0" />
        <span className="font-display text-lg font-bold tracking-tight text-foreground">ISPhub</span>
      </Link>
      <nav aria-label="Navegação principal" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        {agruparMenu(itens).map((grupo) => (
          <div key={grupo.titulo} role="group" aria-label={grupo.titulo} className="flex flex-col gap-0.5">
            <p aria-hidden className="px-2 pb-1.5 pt-3.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {grupo.titulo}
            </p>
            {grupo.itens.map(({ to, label, icon: Icon }) => {
              const ativo = rotaAtiva(to, caminhoAtual);
              const contador = to === "/chat" && naoLidasChat > 0 ? naoLidasChat : null;
              return (
                <Link
                  key={to}
                  to={to}
                  data-nav-item
                  aria-current={ativo ? "page" : undefined}
                  className={cn(
                    "flex min-h-8.5 items-center gap-2.5 rounded-md px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    ativo ? "bg-primary/12 font-semibold text-primary" : "hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="size-[1.0625rem] shrink-0" strokeWidth={1.7} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {contador !== null && (
                    <span className="font-mono text-[0.6875rem] text-muted-foreground">
                      <span className="sr-only">, </span>
                      {contador > 99 ? "99+" : contador}
                      <span className="sr-only"> não lidas</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2.5 border-t border-sidebar-border px-5 py-3">
        <span
          aria-hidden
          className="flex size-7.5 shrink-0 items-center justify-center rounded-full bg-secondary text-[0.6875rem] font-semibold text-foreground"
        >
          {iniciais(nome)}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate font-medium text-foreground">{nome}</p>
          <p className="truncate text-[0.6875rem] text-muted-foreground">
            {USER_ROLE_LABEL[papel]} ·{" "}
            <span className="font-mono" title={APP_BUILD_ID ? `Build ${APP_BUILD_ID}` : undefined}>
              {APP_VERSION_LABEL}
            </span>
          </p>
        </div>
      </div>
    </aside>
  );
}

/** A marca: um no de rede com tres enlaces, no ciano do tema. */
function LogoIsphub({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <rect width="28" height="28" rx="7" className="fill-primary" />
      <path d="M14 14L7.5 8.5M14 14l6.5-5.5M14 14v7.5" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round" />
      <circle cx="14" cy="14" r="3" className="fill-primary-foreground" />
    </svg>
  );
}

function navItemClass(ativo: boolean): string {
  return cn(
    // No mobile: aba com icone empilhado. No desktop: segmented pill horizontal.
    "group relative flex min-w-16 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-2 text-[0.7rem] font-medium transition-all lg:min-w-0 lg:flex-none lg:shrink-0 lg:flex-row lg:gap-1.5 lg:rounded-lg lg:px-3 lg:py-1.5 lg:text-xs lg:font-medium min-h-12 pointer-coarse:min-h-12 lg:min-h-8",
    ativo
      ? "text-primary font-semibold"
      : "text-muted-foreground hover:text-foreground lg:hover:bg-background/50",
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
  itensSoDesktop,
  onAbrirDesempenho,
  onAbrirRotaDoDia,
}: {
  nome: string;
  role: UserRole;
  onLogout: () => void;
  /** Itens marcados `soDesktop` — saem da barra do rodape e entram aqui no celular. */
  itensSoDesktop: { to: string; label: string; icon: typeof LayoutGrid }[];
  onAbrirDesempenho?: () => void;
  onAbrirRotaDoDia?: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${nome} — ${USER_ROLE_LABEL[role]}`}
          aria-label={`Menu do usuário — ${nome}`}
          className="flex items-center gap-2 rounded-lg p-1 outline-none transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
            {iniciais(nome)}
            <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-background bg-success" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 rounded-xl border border-border/60 bg-background/98 p-1.5 shadow-xl backdrop-blur-md">
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
        {/*
          `lg:hidden`: no desktop estes itens ja estao na linha do cabecalho, e
          repeti-los aqui seria dois caminhos pro mesmo lugar. No celular esta
          e a UNICA porta — sem isto o admin de telefone na mao nao teria como
          chegar la (ver `soDesktop` em NAV_ITEMS).
        */}
        {itensSoDesktop.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={() => setAberto(false)}
            className="mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 lg:hidden"
          >
            <Icon className="size-4 text-muted-foreground" />
            {label}
          </Link>
        ))}
        {role === UserRole.TECNICO && onAbrirRotaDoDia && (
          <button
            type="button"
            onClick={() => {
              setAberto(false);
              onAbrirRotaDoDia();
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-teal-700 dark:text-teal-300 outline-none transition-colors hover:bg-teal-500/10 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
          >
            <Route className="size-4 text-teal-600 dark:text-teal-400" />
            Minha Rota do Dia
          </button>
        )}
        {role === UserRole.TECNICO && onAbrirDesempenho && (
          <button
            type="button"
            onClick={() => {
              setAberto(false);
              onAbrirDesempenho();
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-amber-700 dark:text-amber-300 outline-none transition-colors hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
          >
            <Trophy className="size-4 text-amber-500" />
            Meu Desempenho & Ranking
          </button>
        )}
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
        <div className="mt-1 flex items-center justify-between border-t border-border/50 px-2.5 pt-2 text-[10px] font-mono text-muted-foreground">
          <span>ISPhub</span>
          <span>{APP_VERSION_LABEL}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Mais" — os itens de navegacao que nao couberam na linha.
 *
 * Duas instancias: a da linha do desktop (`hidden lg:flex`, com o que nao
 * coube) e a do rodape do celular (`rodape`, `lg:hidden`, com o que nao e aba
 * fixa — ver FIXOS_RODAPE). Nunca as duas visiveis juntas, e o Popover do
 * Radix so monta o conteudo quando aberto: nao ha link duplicado na arvore
 * de acessibilidade.
 */
function NavExcesso({
  itens,
  caminhoAtual,
  naoLidasChat,
  rodape = false,
}: {
  itens: { to: string; label: string; icon: typeof LayoutGrid }[];
  caminhoAtual: string;
  naoLidasChat: number;
  /** Variante da barra do celular (`lg:hidden`), com cara de aba. */
  rodape?: boolean;
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
          className={
            rodape
              ? cn(navItemClass(contemAtual), "lg:hidden")
              : cn(
                  "hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors lg:flex lg:min-h-8 pointer-coarse:min-h-11",
                  contemAtual
                    ? "bg-background text-foreground shadow-xs border border-border/60"
                    : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                )
          }
        >
          {rodape ? (
            <>
              <NavIcon Icon={MoreHorizontal} ativo={contemAtual} />
              <span className="relative">Mais</span>
            </>
          ) : (
            <>
              <MoreHorizontal className="size-3.5 shrink-0" />
              Mais
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side={rodape ? "top" : undefined} className="w-56 rounded-xl border border-border/60 bg-background/98 p-1.5 shadow-xl backdrop-blur-md">
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
  const [naoLidasChat, setNaoLidasChat] = useState(0);
  const { ids: modulosHabilitados } = useModulosHabilitados();
  const [desempenhoAberto, setDesempenhoAberto] = useState(false);
  const [rotaDoDiaAberta, setRotaDoDiaAberta] = useState(false);

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
        // Atendente: lista de PERMISSAO (Painel e Agenda). Item novo nao aparece pra ela por engano.
        (usuario.role === UserRole.ATENDENTE
          ? NAV_ATENDENTE.has(item.to)
          : usuario.role === UserRole.VENDEDOR
            ? NAV_VENDEDOR.has(item.to)
            : !item.ocultoPara.includes(usuario.role)) &&
        (usuario.role === UserRole.VENDEDOR || !item.modulo || modulosHabilitados.has(item.modulo)) &&
        // Supervisor com areas definidas: so as telas das areas dele (null = todas).
        (usuario.role !== UserRole.GESTOR || podeRotaWeb(usuario.permissoes ?? null, item.to)),
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
    // O trabalho do papel primeiro (Despacho para o gestor, Marcar visita para a atendente).
    return ordenarPorPapel(base, usuario?.role);
  }, [usuario, modulosHabilitados]);

  // Rodape do celular: se tudo cabe (tecnico, provedor), mostra tudo; senao,
  // as abas fixas do perfil e o resto no "Mais". `soDesktop` nunca entra.
  const doRodape = itensNav.filter((i) => !i.soDesktop);
  const fixosRodape = new Set(
    doRodape.length <= MAX_ABAS_RODAPE
      ? doRodape.map((i) => i.to)
      : fixosRodapeDoPapel(usuario?.role).filter((to) => doRodape.some((i) => i.to === to)).slice(0, MAX_ABAS_RODAPE - 1),
  );
  const maisRodape = doRodape.filter((i) => !fixosRodape.has(i.to));

  // Supervisor sem a area do chat: `/chat/nao-lidas` daria 403 a cada 45 s.
  const veChat =
    !!usuario &&
    !escopadoPorProvedor(usuario.role) &&
    (usuario.role !== UserRole.GESTOR || podeRotaWeb(usuario.permissoes ?? null, "/chat"));

  useEffect(() => {
    if (!veChat) return;
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
  }, [usuario, veChat]);

  useRealtime((evento) => {
    if (veChat && (evento.tipo === "chat-mensagem" || evento.tipo === "chat-leitura")) {
      chatApi
        .naoLidas()
        .then(({ naoLidas }) => setNaoLidasChat(naoLidas))
        .catch(() => {});
    }
  });

  const inicio = inicioDoPapel(usuario?.role, usuario?.permissoes);

  return (
    <div className="min-h-svh lg:flex">
      {/*
        Desktop: menu lateral fixo, agrupado. Abaixo de `lg` ele nao existe
        (`hidden`, fora da arvore de acessibilidade) e a navegacao e a barra do
        rodape, la embaixo — nunca os dois ao mesmo tempo.
      */}
      {usuario && (
        <MenuLateral
          itens={itensNav}
          caminhoAtual={location.pathname}
          naoLidasChat={naoLidasChat}
          inicio={inicio}
          nome={usuario.nome}
          papel={usuario.role}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
      {/*
        Sem backdrop-blur AQUI de proposito: `backdrop-filter` num ancestral
        cria containing block pra descendentes `position: fixed` (CSS
        Transforms spec) — a nav abaixo é fixa no rodape no mobile, e um
        header com blur faria ela "grudar" no fim do header (perto do topo)
        em vez do fim da viewport de verdade. O blur fica só na propria nav.
      */}
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4 lg:px-7">
          {/* A marca do topo e so do celular: no desktop ela mora no menu lateral. */}
          <Link to={inicio} className="mr-1 flex shrink-0 items-center gap-2 pointer-coarse:min-h-11 lg:hidden">
            <LogoIsphub className="size-6.5" />
            <span className="font-display text-lg font-bold tracking-tight text-foreground">ISPhub</span>
          </Link>

          {/*
            Barra do rodape, SO abaixo de `lg`: alcance de polegar pro tecnico
            em campo. Quatro abas fixas do papel e o resto em "Mais".
          */}
          {usuario && (
            <nav
              className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
              aria-label="Navegação principal"
            >
              {itensNav.map(({ to, label, labelCurto, icon: Icon, soDesktop }) => {
                const ativo = rotaAtiva(to, location.pathname);
                return (
                  <Link
                    key={to}
                    to={to}
                    title={label}
                    data-nav-item
                    aria-current={ativo ? "page" : undefined}
                    className={cn(navItemClass(ativo), (!!soDesktop || !fixosRodape.has(to)) && "hidden")}
                  >
                    <NavIcon
                      Icon={Icon}
                      ativo={ativo}
                      badge={to === "/chat" ? naoLidasChat : undefined}
                    />
                    {/*
                      Rotulo curto na aba (cabem ~53px em 375px). O nome COMPLETO
                      continua como texto (sr-only) e no `title`, entao leitor de
                      tela, tooltip e testes nao mudam. Ver a nota em
                      `labelCurto` sobre por que nao e aria-label.
                    */}
                    <span className="relative" aria-hidden={labelCurto ? true : undefined}>
                      {labelCurto ?? label}
                    </span>
                    {labelCurto && <span className="sr-only">{label}</span>}
                  </Link>
                );
              })}
              {maisRodape.length > 0 && (
                <NavExcesso itens={maisRodape} caminhoAtual={location.pathname} naoLidasChat={naoLidasChat} rodape />
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
            {usuario?.role === UserRole.TECNICO && (
              <>
                <button
                  type="button"
                  onClick={() => setRotaDoDiaAberta(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2 py-1.5 sm:px-3 sm:py-2 text-xs font-bold text-teal-700 hover:bg-teal-500/20 dark:text-teal-300 transition-colors min-h-9 sm:min-h-10 shadow-xs"
                  title="Minha Rota do Dia Otimizada no Mapa"
                >
                  <Route className="size-3.5 sm:size-4 text-teal-600 dark:text-teal-400 shrink-0" />
                  <span className="font-bold">
                    Rota<span className="hidden sm:inline"> do dia</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDesempenhoAberto(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 sm:px-3 sm:py-2 text-xs font-bold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300 transition-colors min-h-9 sm:min-h-10 shadow-xs"
                  title="Meu Desempenho e Ranking Privado"
                >
                  <Trophy className="size-3.5 sm:size-4 text-amber-500 shrink-0" />
                  <span className="font-bold sm:hidden">Ranking</span>
                  <span className="font-bold hidden sm:inline">Desempenho</span>
                </button>
              </>
            )}
            {usuario && (
              <span className={usuario.role === UserRole.TECNICO ? "hidden sm:inline-flex" : "inline-flex"}>
                <CommandPalette />
              </span>
            )}
            {usuario && <NotificationBell />}
            {usuario && (
              <UserMenu
                nome={usuario.nome}
                role={usuario.role}
                onLogout={logout}
                itensSoDesktop={itensNav.filter((i) => i.soDesktop)}
                onAbrirDesempenho={() => setDesempenhoAberto(true)}
                onAbrirRotaDoDia={() => setRotaDoDiaAberta(true)}
              />
            )}
          </div>
        </div>
      </header>

      <SyncBanner />

      {/* pb extra no mobile: a aba de navegacao fixa no rodape nao pode
          cobrir o final da lista/conteudo. */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-24 lg:px-7 lg:pb-6">
        {children}
      </main>

      </div>

      {usuario?.role === UserRole.TECNICO && (
        <>
          <MeuDesempenhoDialog
            aberto={desempenhoAberto}
            onFechar={() => setDesempenhoAberto(false)}
          />
          <RotaDoDiaModal
            aberto={rotaDoDiaAberta}
            onFechar={() => setRotaDoDiaAberta(false)}
          />
        </>
      )}
    </div>
  );
}
