import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { api } from "@/lib/apiClient";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Pedido do link de redefinicao.
 *
 * A tela de sucesso e deliberadamente AMBIGUA ("se houver uma conta..."): a API
 * responde igual pra e-mail cadastrado e nao cadastrado, e a interface tem que
 * honrar isso. Um "e-mail nao encontrado" aqui entregaria a lista de quem tem
 * conta pra qualquer um que quisesse tentar senhas depois.
 */
export function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.post("/auth/recuperar-senha", { email });
      setEnviado(true);
    } catch (err) {
      // Só chega aqui em falha real (rede, rate limit) — nunca em "e-mail não
      // existe", que a API trata como sucesso.
      setErro(err instanceof Error ? err.message : "Não foi possível enviar agora. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        {/*
          BrandMark e o logotipo COMPLETO (glifo + wordmark + slogan), feito
          pra container largo. Passar `size-12` fixava 3rem de largura e altura
          no flex externo: o slogan quebrava e transbordava por cima do titulo.
          Mesmo uso do login — sem restricao de tamanho, titulo ABAIXO.
        */}
        <div className="mb-10 flex justify-center">
          <BrandMark />
        </div>

        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold tracking-tight">Recuperar acesso</h1>
        </div>

        {enviado ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-center">
            <MailCheck className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <div className="flex flex-col gap-2">
              <p className="font-medium">Confira sua caixa de entrada</p>
              <p className="text-sm text-muted-foreground">
                Se houver uma conta com <strong className="font-medium text-foreground">{email}</strong>, o link de
                redefinição já está a caminho. Ele vale por 1 hora.
              </p>
              <p className="text-sm text-muted-foreground">Não recebeu? Verifique o spam antes de pedir outro.</p>
            </div>
            <Button asChild variant="outline" className="mt-2">
              <Link to="/login">Voltar ao login</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={enviando}>
            <p className="text-sm text-muted-foreground">
              Informe o e-mail da sua conta. Enviaremos um link para você escolher uma nova senha.
            </p>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="voce@provedor.com.br"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
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

            <Button type="submit" variant="brand" size="lg" disabled={enviando}>
              {enviando ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Enviando...
                </>
              ) : (
                "Enviar link"
              )}
            </Button>

            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-1.5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Voltar ao login
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
