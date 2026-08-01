import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/lib/apiClient";
import { BrandMark } from "@/components/BrandMark";
import { CampoSenha } from "@/components/CampoSenha";
import { Button } from "@/components/ui/button";

const MINIMO = 8;

/**
 * Consome o link do e-mail e troca a senha.
 *
 * O token vem na query string. Link sem token, expirado ou ja usado cai numa
 * mensagem explicita com caminho de saida — nunca em tela branca, que era o
 * comportamento do app pra qualquer rota nao prevista.
 */
export function RedefinirSenhaPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    // Validação no cliente antes de gastar uma ida ao servidor — e antes de
    // consumir o token, que é de uso único.
    if (senha.length < MINIMO) {
      setErro(`A senha precisa ter pelo menos ${MINIMO} caracteres.`);
      return;
    }
    if (senha !== confirmacao) {
      setErro("As duas senhas não são iguais.");
      return;
    }

    setEnviando(true);
    try {
      await api.post("/auth/redefinir-senha", { token, novaSenha: senha });
      setPronto(true);
      // Leva pro login sozinho, mas com tempo de ler a confirmação.
      setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível redefinir a senha.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Mesmo uso do login: BrandMark sem restricao de tamanho (ele e o
            logotipo completo, com slogan), titulo abaixo. Ver RecuperarSenhaPage. */}
        <div className="mb-10 flex justify-center">
          <BrandMark />
        </div>

        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold tracking-tight">Nova senha</h1>
        </div>

        {!token ? (
          <div className="flex flex-col gap-4 rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <AlertCircle className="mx-auto size-8 text-destructive" aria-hidden />
            <p className="text-sm text-destructive">
              Este link está incompleto. Peça um novo link de redefinição.
            </p>
            <Button asChild variant="outline">
              <Link to="/recuperar-senha">Pedir novo link</Link>
            </Button>
          </div>
        ) : pronto ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6 text-center" role="status">
            <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
            <p className="font-medium">Senha alterada</p>
            <p className="text-sm text-muted-foreground">
              Suas outras sessões foram encerradas por segurança. Entre novamente com a senha nova.
            </p>
            <Button asChild variant="brand" className="mt-2">
              <Link to="/login">Ir para o login</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={enviando}>
            <CampoSenha
              id="nova-senha"
              label="Nova senha"
              valor={senha}
              aoMudar={setSenha}
              autoComplete="new-password"
              ajuda={`Pelo menos ${MINIMO} caracteres.`}
              autoFocus
            />

            <CampoSenha
              id="confirmar-senha"
              label="Repita a nova senha"
              valor={confirmacao}
              aoMudar={setConfirmacao}
              autoComplete="new-password"
            />

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
                  Salvando...
                </>
              ) : (
                "Salvar nova senha"
              )}
            </Button>

            <Link
              to="/login"
              className="py-2 text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Voltar ao login
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
