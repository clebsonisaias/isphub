import { useState, type FormEvent } from "react";
import { USER_ROLE_LABEL } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/lib/authApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { KeyRound } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

export function PerfilPage() {
  const { usuario } = useAuth();
  const { toast } = useToast();
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (!usuario) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (novaSenha !== confirmarSenha) {
      toast({ titulo: "As senhas não coincidem", variante: "erro" });
      return;
    }
    setEnviando(true);
    try {
      await authApi.trocarSenha(senhaAtual, novaSenha);
      toast({ titulo: "Senha alterada com sucesso", variante: "sucesso" });
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmarSenha("");
    } catch (err) {
      toast({ titulo: "Erro ao trocar senha", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AppShell>
      <AnimatedPage>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Meu perfil</h1>
        <p className="text-sm text-muted-foreground">
          {usuario.nome} · {usuario.email} · {USER_ROLE_LABEL[usuario.role]}
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Trocar senha</CardTitle>
          <CardDescription>Você precisa da sua senha atual para definir uma nova.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="senhaAtual">Senha atual</Label>
              <Input
                id="senhaAtual"
                type="password"
                required
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="novaSenha">Nova senha</Label>
              <Input
                id="novaSenha"
                type="password"
                required
                minLength={8}
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmarSenha">Confirmar nova senha</Label>
              <Input
                id="confirmarSenha"
                type="password"
                required
                minLength={8}
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              variant="brand"
              className="w-fit"
              disabled={enviando || !senhaAtual || novaSenha.length < 8}
            >
              <KeyRound className="size-3.5" />
              {enviando ? "Salvando..." : "Trocar senha"}
            </Button>
          </form>
        </CardContent>
      </Card>
      </AnimatedPage>
    </AppShell>
  );
}
