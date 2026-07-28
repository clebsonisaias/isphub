import { useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { gsap, useGSAP } from "@/lib/gsapSetup";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/apiClient";
import { BrandMark } from "@/components/BrandMark";
import { GeoDecor } from "@/components/GeoDecor";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function reduzirMovimento() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Entrada do card logo depois da animacao do glifo de marca.
  useGSAP(() => {
    if (!cardRef.current) return;
    if (reduzirMovimento()) {
      gsap.set(cardRef.current, { opacity: 1 });
      return;
    }
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.5, delay: 0.5, ease: "power1.out" },
    );
  }, []);

  // Shake sutil no card ao errar login — feedback imediato, sem depender so da cor do texto.
  useGSAP(
    () => {
      if (!erro || !cardRef.current || reduzirMovimento()) return;
      // keyframes (array): replica o multi-ponto [0,-8,8,-6,6,0] do anime.js
      // original — 5 segmentos iguais somando os 400ms totais.
      gsap.to(cardRef.current, {
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

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden px-4">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[36rem] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: "linear-gradient(135deg, var(--brand-from), var(--brand-to))" }}
      />
      {/* Geometria Memphis do telao — atras de tudo, leve, nunca sobre o
          formulario (GeoDecor ja e aria-hidden/pointer-events-none). */}
      <GeoDecor variant="hero" />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-8">
        <BrandMark />

        <Card ref={cardRef} className="w-full opacity-0">
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Acesse o painel do ISPhub com seu e-mail e senha.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@provedor.com.br"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="senha">Senha</Label>
                <Input
                  id="senha"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {erro && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {erro}
                </p>
              )}

              <Button type="submit" variant="brand" size="lg" disabled={enviando} className="mt-2">
                {enviando ? "Entrando..." : "Entrar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
