import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { USER_ROLE_LABEL, UserRole, escopadoPorProvedor, type ModuloId } from "@isphub/shared";
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
  Gauge,
  Settings,
  PackageX,
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
  /*
   * Produtividade da equipe. PROVEDOR nao ve: a equipe e da HubISP, e o
   * desempenho dela nao e informacao de cliente. TECNICO tambem nao — ver a
   * rota em App.tsx.
   */
  {
    to: "/produtividade",
    label: "Produtividade",
    labelCurto: "Equipe",
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

/** O que a atendente ve na barra: lista de permissao, nao de exclusao. */
const NAV_ATENDENTE = new Set(["/", "/agenda"]);

/**
 * As abas FIXAS da barra do rodape no celular, em ordem de preferencia: ficam
 * as 4 primeiras que o perfil enxerga, e o resto vai pro "Mais" do rodape.
 * Supervisor: Painel, Agenda, Mapa, Chat. Tecnico: Painel, Mapa, Chat,
 * Clientes. Provedor: Painel, Mapa, Retiradas, Dashboard.
 *
 * Com 13 abas (admin) a barra rolava de lado: resolvia o estouro, mas ninguem
 * descobre a 10a aba rolando. Quatro fixas + "Mais" e o padrao de app.
 */
const FIXOS_RODAPE = ["/", "/agenda", "/mapa", "/chat", "/retiradas", "/dashboard", "/chat-clientes"];
const MAX_ABAS_RODAPE = 5;

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
  /**
   * A medicao ja chegou a uma conclusao?
   *
   * Enquanto for `false`, o cabecalho mostra TODOS os itens — nao porque cabem,
   * mas porque ainda nao se sabe. E um estado transitorio real, e quem le a
   * barra nesse instante (pessoa ou teste) le uma linha que ainda vai mudar.
   * Vira `data-nav-medido` no DOM pra que dê pra esperar por ele.
   */
  const [medido, setMedido] = useState(false);
  const largurasRef = useRef<number[] | null>(null);
  const retryRef = useRef<number | null>(null);

  const recalcular = useCallback(() => {
    const el = navRef.current;
    if (!el) return;

    // Abaixo de `lg` o nav e a barra fixa do rodape, com layout proprio —
    // nada de esconder item ali.
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      setCabem(qtdItens);
      setMedido(true);
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
      if (medidas.length < qtdItens || medidas.some((w) => w === 0)) {
        /*
         * ESTE agendamento faltava, e o comentario acima prometia ele.
         *
         * Sem reagendar, a remedicao so acontecia se algo MAIS causasse um
         * render — na pratica, o reflow do carregamento da fonte. Ate la o
         * cabecalho ficava com todos os itens na linha e depois recolhia: um
         * pulo visivel, e a janela em que o teste do menu lia a barra antes de
         * ela assentar (falhou duas vezes em 07/08).
         */
        if (retryRef.current === null) {
          retryRef.current = requestAnimationFrame(() => {
            retryRef.current = null;
            recalcularRef.current?.();
          });
        }
        return;
      }
      largurasRef.current = medidas;
    }

    const larguras = largurasRef.current;
    const disponivel = el.clientWidth;
    const total = larguras.reduce((a, b) => a + b, 0) + GAP_NAV * (larguras.length - 1);
    setMedido(true);
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

  // O rAF acima precisa chamar a versao ATUAL de `recalcular`; a ref evita a
  // dependencia circular de referenciar o callback dentro dele mesmo.
  const recalcularRef = useRef(recalcular);
  // Escrita fora do render (regra no-ref-current-in-render): roda no commit,
  // antes do useLayoutEffect(recalcular) abaixo, entao o rAF de retry sempre le
  // a versao atual. Sem deps = atualiza a cada commit, igual a escrita anterior.
  useLayoutEffect(() => {
    recalcularRef.current = recalcular;
  });

  useEffect(() => () => {
    if (retryRef.current !== null) cancelAnimationFrame(retryRef.current);
  }, []);

  // Lista mudou (modulo ligado/desligado, troca de papel): remede do zero.
  useLayoutEffect(() => {
    largurasRef.current = null;
    setMedido(false);
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

  return { cabem, medido };
}

/**
 * Classe de um item de navegacao — um unico elemento serve dois papeis pelo
 * breakpoint `lg`: aba de rodape (mobile/tablet, alcance de polegar) e pilula
 * no cabecalho (desktop). Nunca existem os dois ao mesmo tempo (nao ha
 * duplicacao de Link/nome acessivel — so uma troca de layout via CSS), entao
 * o rotulo "Administração" continua unico na arvore de acessibilidade em
 * qualquer largura, do jeito que os testes e2e esperam.
 */
/**
 * UMA classe de display, decidida aqui — nunca duas empilhadas no `cn`.
 *
 * Empilhar `"lg:hidden"` com `"hidden lg:flex"` parece somar as duas regras,
 * mas o tailwind-merge deduplica por grupo de utilitario e o ULTIMO vence:
 * `lg:flex` apagava o `lg:hidden`, e o item marcado `soDesktop` nunca
 * conseguia ir pro menu "Mais". Resultado medido: a linha do cabecalho
 * estourava em TODAS as larguras de desktop, de 1024 a 1920.
 */
function classeVisibilidade(soNoExcesso: boolean, foraDoRodape: boolean): string {
  // Fora da barra do rodape E ja empurrado pro "Mais": nao aparece em lugar
  // nenhum como item de linha (o menu "Mais" o renderiza por conta propria).
  if (foraDoRodape && soNoExcesso) return "hidden";
  // Fora da barra do rodape, mas cabe na linha do desktop.
  if (foraDoRodape) return "hidden lg:flex";
  // Coube no rodape; some so da LINHA do desktop e reaparece no "Mais".
  if (soNoExcesso) return "lg:hidden";
  return "";
}

function navItemClass(ativo: boolean): string {
  return cn(
    // `lg:shrink-0` + `whitespace-nowrap`: agora que o nav rola (ver a nota no
    // <nav>), a pilula nao pode ser comprimida nem quebrar o rotulo em duas
    // linhas — ela sai de vista rolando, inteira, e volta do mesmo jeito.
    "group relative flex min-w-16 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-1 py-2 text-[0.65rem] font-medium transition-colors lg:min-w-0 lg:flex-none lg:shrink-0 lg:flex-row lg:gap-1.5 lg:rounded-full lg:px-3 lg:py-1.5 lg:text-sm pointer-coarse:min-h-11",
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
  itensSoDesktop,
}: {
  nome: string;
  role: UserRole;
  onLogout: () => void;
  /** Itens marcados `soDesktop` — saem da barra do rodape e entram aqui no celular. */
  itensSoDesktop: { to: string; label: string; icon: typeof LayoutGrid }[];
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
                  // `pointer-coarse:min-h-11` como os demais itens: em tablet
                  // paisagem (1024px COM toque) o botao ficava 76x32px, abaixo do
                  // minimo de 44px.
                  "hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors lg:flex pointer-coarse:min-h-11",
                  contemAtual
                    ? "bg-primary/12 text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
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
              <MoreHorizontal className="size-4 shrink-0" />
              Mais
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side={rodape ? "top" : undefined} className="w-52 p-1.5">
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
        // Atendente: lista de PERMISSAO (Painel e Agenda). Item novo nao aparece pra ela por engano.
        (usuario.role === UserRole.ATENDENTE ? NAV_ATENDENTE.has(item.to) : !item.ocultoPara.includes(usuario.role)) &&
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

  const { cabem, medido: navMedido } = useQuantosCabem(itensNav.length, navRef);
  const noExcesso = itensNav.slice(cabem);
  // Rodape do celular: se tudo cabe (tecnico, provedor), mostra tudo; senao,
  // as abas fixas do perfil e o resto no "Mais". `soDesktop` nunca entra.
  const doRodape = itensNav.filter((i) => !i.soDesktop);
  const fixosRodape = new Set(
    doRodape.length <= MAX_ABAS_RODAPE
      ? doRodape.map((i) => i.to)
      : FIXOS_RODAPE.filter((to) => doRodape.some((i) => i.to === to)).slice(0, MAX_ABAS_RODAPE - 1),
  );
  const maisRodape = doRodape.filter((i) => !fixosRodape.has(i.to));

  useEffect(() => {
    if (!usuario || escopadoPorProvedor(usuario.role)) return;
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
               *
               * No celular a barra do rodape tem no maximo 5 abas: as fixas do
               * perfil + "Mais" (ver FIXOS_RODAPE). Com as 13 do admin em 375px,
               * `flex-1` comprimia cada aba a 36px e as ultimas saiam da tela.
               */
              className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:static lg:inset-auto lg:z-auto lg:min-w-0 lg:flex-1 lg:items-center lg:justify-start lg:gap-1 lg:overflow-x-auto lg:border-t-0 lg:bg-transparent lg:pb-0 lg:backdrop-blur-none lg:scrollbar-none"
              aria-label="Navegação principal"
              /*
               * `false` enquanto a medicao nao concluiu — nesse instante a
               * barra mostra todos os itens porque ainda nao se SABE quais
               * cabem, nao porque cabem. Deixa isso legivel de fora.
               */
              data-nav-medido={navMedido}
            >
              {itensNav.map(({ to, label, labelCurto, icon: Icon, soDesktop }, i) => {
                const ativo = to === "/admin" ? location.pathname.startsWith("/admin") : location.pathname === to;
                const soNoExcesso = i >= cabem;
                return (
                  <Link
                    key={to}
                    to={to}
                    title={label}
                    data-nav-item
                    /*
                     * `lg:hidden` quando nao coube: some da LINHA e reaparece
                     * dentro de "Mais". Abaixo de `lg` continua visivel — ali o
                     * nav e a barra do rodape, com layout proprio.
                     */
                    className={cn(navItemClass(ativo), classeVisibilidade(soNoExcesso, !!soDesktop || !fixosRodape.has(to)))}
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
                    {/*
                      Rotulo curto em TODA largura, nao so no rodape do mobile.
                      "Administração"/"Provisionar" sozinhos custam ~255px dos
                      ~780px que a linha tem; como "Admin"/"ONU" custam ~155px,
                      e a diferenca entre os 8 itens caberem na linha ou dois
                      deles irem pro menu "Mais" — um clique a mais em algo que
                      cabia. O nome COMPLETO continua como texto (sr-only) e no
                      `title`, entao leitor de tela, tooltip e testes nao mudam.
                      Ver a nota em `labelCurto` sobre por que nao e aria-label.
                    */}
                    <span className="relative" aria-hidden={labelCurto ? true : undefined}>
                      {labelCurto ?? label}
                    </span>
                    {labelCurto && <span className="sr-only">{label}</span>}
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
            {usuario && <CommandPalette />}
            {usuario && <NotificationBell />}
            {usuario && (
              <UserMenu
                nome={usuario.nome}
                role={usuario.role}
                onLogout={logout}
                itensSoDesktop={itensNav.filter((i) => i.soDesktop)}
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
