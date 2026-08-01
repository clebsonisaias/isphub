import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Loader2, MapPin, Radio, Smartphone } from "lucide-react";
import { gsap, useGSAP } from "@/lib/gsapSetup";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/apiClient";
import { BrandMark } from "@/components/BrandMark";
import { GeoDecor } from "@/components/GeoDecor";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Vale animar a entrada agora?
 *
 * Duas razoes pra dizer que nao, e as duas terminam no mesmo estrago: o GSAP
 * escreve o estado INICIAL (opacity 0) de imediato e so sai dele quadro a
 * quadro. Com a aba em segundo plano o navegador congela o requestAnimationFrame,
 * o tween nunca avanca e o formulario fica invisivel — sem nada na tela pra
 * denunciar o motivo. Acontece de verdade: aba aberta em background, restauracao
 * de sessao do navegador, link aberto com Cmd+clique.
 *
 * Animacao de entrada pra quem nao esta olhando nao serve pra nada, entao
 * pular e resolver saem de graca. `prefers-reduced-motion` entra na mesma
 * porta por ser a mesma decisao: "renderize direto no estado final".
 */
function animarEntrada() {
  if (document.hidden) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * O que o painel faz, em tres linhas. Nao e enfeite: e a unica tela do produto
 * que alguem ve antes de ter acesso, entao vale dizer do que se trata. Cada
 * item descreve capacidade que existe de fato (fila espelhada do SGP, SLA,
 * app do tecnico) — nada de promessa generica.
 */
const CAPACIDADES = [
  { Icone: Radio, titulo: "Fila espelhada do SGP", texto: "As OS abertas no ERP aparecem aqui sozinhas, e somem quando fecham." },
  { Icone: MapPin, titulo: "Campo no mapa", texto: "Endereço e coordenada de cada atendimento, com o contato do cliente junto." },
  { Icone: Smartphone, titulo: "App do técnico", texto: "Quem está na rua recebe a OS, anexa foto e encerra do próprio celular." },
] as const;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [capsLigado, setCapsLigado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  /*
   * Entrada com `from`, nao `fromTo` com `opacity-0` na classe: o estado de
   * REPOUSO no HTML passa a ser o visivel, e o GSAP so recua pra animar. Antes,
   * se o bundle do GSAP nao carregasse, o formulario ficava invisivel pra
   * sempre — e um formulario de login nao pode depender de JS pra existir na
   * tela. O `animarEntrada()` cobre o outro lado: GSAP carregado mas parado.
   */
  useGSAP(() => {
    if (!formRef.current || !animarEntrada()) return;
    gsap.from(formRef.current, { opacity: 0, y: 16, duration: 0.5, delay: 0.45, ease: "power1.out" });
  }, []);

  // Shake sutil ao errar — feedback imediato, sem depender so da cor do texto.
  useGSAP(
    () => {
      if (!erro || !formRef.current || !animarEntrada()) return;
      gsap.to(formRef.current, {
        keyframes: [
          { x: -8, duration: 0.08 },
          { x: 8, duration: 0.08 },
          { x: -6, duration: 0.08 },
          { x: 6, duration: 0.08 },
          { x: 0, duration: 0.08 },
        ],
        ease: "sine.inOut",
      });
    },
    { dependencies: [erro] },
  );

  // Credencial recusada: devolve o foco pro e-mail. Sem isso o usuario le o
  // erro e precisa ir de mouse ate o campo pra corrigir (WCAG focus-management).
  useEffect(() => {
    if (erro) emailRef.current?.focus();
  }, [erro]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await login(email, senha);
      const destino = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(destino, { replace: true });
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Falha ao conectar com o servidor");
    } finally {
      setEnviando(false);
    }
  }

  // Caps Lock ligado e a causa silenciosa mais comum de "minha senha nao
  // funciona" — o campo mascarado nao denuncia. `getModifierState` funciona em
  // keydown e keyup, entao o aviso some assim que a tecla e desligada.
  function checarCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLigado(e.getModifierState?.("CapsLock") ?? false);
  }

  return (
    <div className="relative min-h-svh lg:grid lg:grid-cols-[1.1fr_1fr]">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>

      {/*
        Painel de marca — so no desktop. No celular ele viraria uma tela de
        scroll antes do formulario, que e a unica coisa que a pessoa veio
        fazer aqui (content-priority). A geometria Memphis fica CONTIDA neste
        painel: antes ela flutuava solta em volta do formulario, e os acentos
        decorativos apareciam perto de campo de dado.
      */}
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14]"
          style={{ background: "linear-gradient(135deg, var(--brand-from), var(--brand-to))" }}
        />
        <GeoDecor variant="hero" />

        <div className="relative z-10">
          <BrandMark />
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-balance xl:text-5xl">
            A operação do provedor em uma tela só.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Ordens de serviço, equipe em campo e prazo de atendimento — sempre no
            mesmo estado do ERP, sem ninguém digitar duas vezes.
          </p>

          <ul className="mt-10 flex flex-col gap-6">
            {CAPACIDADES.map(({ Icone, titulo, texto }) => (
              <li key={titulo} className="flex gap-4">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg, var(--brand-from), var(--brand-to))" }}
                >
                  <Icone className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold leading-snug">{titulo}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{texto}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          ISPhub — central de operações de rede
        </p>
      </aside>

      {/* Coluna do formulario */}
      <main className="flex min-h-svh flex-col items-center justify-center px-4 py-10 sm:px-8 lg:min-h-0">
        <div className="w-full max-w-sm">
          {/* Marca compacta — so onde o painel da esquerda nao existe. */}
          <div className="mb-10 flex justify-center lg:hidden">
            <BrandMark />
          </div>

          <div className="mb-8">
            <h2 className="font-display text-2xl font-bold tracking-tight">Acessar o painel</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Use o e-mail e a senha cadastrados pelo seu provedor.
            </p>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={enviando}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                ref={emailRef}
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@provedor.com.br"
                // 44px (o padrao `h-10` do Input da 40) — alvo de toque minimo.
                // So aqui: o login e o unico formulario que todo mundo usa, e
                // com frequencia no celular. Nao mexo no Input compartilhado.
                className="h-11"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="senha">Senha</Label>
              <div className="relative">
                <Input
                  id="senha"
                  /*
                   * Sem placeholder de bolinhas: `••••••••` num campo de senha
                   * e visualmente identico a uma senha ja digitada — dava pra
                   * achar que o campo estava preenchido.
                   */
                  type={mostrarSenha ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  onKeyDown={checarCaps}
                  onKeyUp={checarCaps}
                  onBlur={() => setCapsLigado(false)}
                  className="h-11 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  // Alvo de 44px de largura total, mesmo com o icone de 18px.
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={mostrarSenha}
                  aria-controls="senha"
                >
                  {mostrarSenha ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
                </button>
              </div>
              {capsLigado && (
                <p className="flex items-center gap-1.5 text-xs text-warning" role="status">
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  Caps Lock está ligado.
                </p>
              )}
            </div>

            {erro && (
              <p
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
                <span>{erro}</span>
              </p>
            )}

            <Button type="submit" variant="brand" size="lg" disabled={enviando} className="mt-1">
              {enviando ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Esqueceu a senha? Fale com o administrador do seu provedor.
          </p>
        </div>
      </main>
    </div>
  );
}
