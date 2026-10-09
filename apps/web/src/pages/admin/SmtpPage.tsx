import { rotuloDataHora } from "@isphub/shared";
import { useEffect, useState, type FormEvent } from "react";
import type { SmtpConfigPublic } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AdminNav } from "@/components/admin/AdminNav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { smtpApi } from "@/lib/smtpApi";
import { ApiError } from "@/lib/apiClient";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { CheckCircle2, Info, Send, XCircle } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/** Portas conhecidas — evita o erro mais comum (465 x 587 e o TLS de cada uma). */
const PORTAS = [
  { valor: 587, rotulo: "587 — STARTTLS (recomendado)" },
  { valor: 465, rotulo: "465 — TLS implícito" },
  { valor: 25, rotulo: "25 — sem criptografia" },
];

export function SmtpPage() {
  const { toast } = useToast();
  const { usuario } = useAuth();
  const [config, setConfig] = useState<SmtpConfigPublic | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [host, setHost] = useState("");
  const [porta, setPorta] = useState(587);
  const [usuarioSmtp, setUsuarioSmtp] = useState("");
  const [senha, setSenha] = useState("");
  const [remetente, setRemetente] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [destinoTeste, setDestinoTeste] = useState("");

  async function recarregar() {
    try {
      const atual = await smtpApi.obter();
      setConfig(atual);
      setHost(atual.host ?? "");
      setPorta(atual.porta ?? 587);
      setUsuarioSmtp(atual.usuario ?? "");
      setRemetente(atual.remetente ?? "");
      // A senha NUNCA volta do servidor — o campo nasce vazio e vazio
      // significa "manter a que já está salva".
      setSenha("");
    } catch (err) {
      toast({ titulo: "Não foi possível carregar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void recarregar();
    if (usuario?.email) setDestinoTeste(usuario.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.email]);

  async function handleSalvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      await smtpApi.salvar({
        host,
        porta,
        usuario: usuarioSmtp || null,
        // String vazia vira `undefined`: "não mexer na senha", não "apagar".
        senha: senha || undefined,
        remetente: remetente || null,
      });
      toast({ titulo: "Servidor de e-mail salvo", variante: "sucesso" });
      await recarregar();
    } catch (err) {
      toast({ titulo: "Não foi possível salvar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setSalvando(false);
    }
  }

  async function handleTestar() {
    setTestando(true);
    try {
      const r = await smtpApi.testar(destinoTeste);
      toast({
        titulo: r.ok ? "E-mail de teste enviado" : "O servidor recusou o envio",
        descricao: r.mensagem,
        variante: r.ok ? "sucesso" : "erro",
      });
      await recarregar();
    } catch (err) {
      toast({ titulo: "Não foi possível testar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setTestando(false);
    }
  }

  const vindoDoAmbiente = config?.origem === "ambiente";

  return (
    <AppShell>
      <AnimatedPage>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Administração</h1>
          <p className="text-sm text-muted-foreground">Servidor de e-mail usado pela recuperação de senha.</p>
        </div>
        <AdminNav />

        <div className="flex flex-col gap-6">
          {/*
            Sem este aviso, uma instalação que já manda e-mail pelas variáveis
            de ambiente apareceria como "não configurado" — e o admin poderia
            sobrescrever uma configuração boa achando que não havia nenhuma.
          */}
          {vindoDoAmbiente && (
            <p className="flex items-start gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground">
              <Info className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                Hoje o envio usa as variáveis de ambiente do servidor (<code className="text-xs">{config?.host}</code>).
                O que você salvar aqui passa a valer no lugar delas, sem precisar de novo deploy.
              </span>
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Servidor de e-mail (SMTP)</CardTitle>
              <CardDescription>
                É por aqui que sai o link de redefinição de senha. Sem isso configurado, quem esquecer a senha depende
                de um administrador redefinir manualmente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSalvar} className="flex flex-col gap-4" aria-busy={salvando}>
                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="host">Servidor</Label>
                    <Input
                      id="host"
                      placeholder="smtp.seudominio.com.br"
                      required
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      className="h-11"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="porta">Porta</Label>
                    <select
                      id="porta"
                      value={porta}
                      onChange={(e) => setPorta(Number(e.target.value))}
                      className="h-11 rounded-md border border-input bg-secondary/40 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {PORTAS.map((p) => (
                        <option key={p.valor} value={p.valor}>
                          {p.rotulo}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="usuario-smtp">Usuário</Label>
                  <Input
                    id="usuario-smtp"
                    autoComplete="off"
                    placeholder="nao-responda@seudominio.com.br"
                    value={usuarioSmtp}
                    onChange={(e) => setUsuarioSmtp(e.target.value)}
                    className="h-11"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="senha-smtp">Senha</Label>
                  <Input
                    id="senha-smtp"
                    type="password"
                    autoComplete="new-password"
                    placeholder={config?.senhaMascarada ? `Salva (${config.senhaMascarada})` : "Nenhuma senha salva"}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    aria-describedby="ajuda-senha"
                    className="h-11"
                  />
                  <p id="ajuda-senha" className="text-xs text-muted-foreground">
                    Deixe em branco para manter a senha atual. Ela nunca é exibida de volta.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="remetente">Remetente</Label>
                  <Input
                    id="remetente"
                    placeholder="ISPhub &lt;nao-responda@seudominio.com.br&gt;"
                    value={remetente}
                    onChange={(e) => setRemetente(e.target.value)}
                    className="h-11"
                  />
                </div>

                <Button type="submit" variant="brand" className="w-fit" disabled={salvando || !host}>
                  {salvando ? "Salvando..." : "Salvar"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Testar envio</CardTitle>
              <CardDescription>
                Manda uma mensagem de verdade. É o único jeito de saber que funciona antes de alguém precisar
                recuperar a senha — SMTP errado só apareceria com a pessoa já trancada do lado de fora.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {config?.ultimaVerificacaoEm && (
                <p className="flex items-start gap-2 text-sm">
                  {config.ultimaVerificacaoOk ? (
                    <CheckCircle2 className="mt-px size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <XCircle className="mt-px size-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  <span className="text-muted-foreground">
                    Último teste em {rotuloDataHora(config.ultimaVerificacaoEm)} —{" "}
                    <span className={config.ultimaVerificacaoOk ? "text-foreground" : "text-destructive"}>
                      {config.ultimaVerificacaoMensagem}
                    </span>
                  </span>
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor="destino-teste">Enviar para</Label>
                  <Input
                    id="destino-teste"
                    type="email"
                    value={destinoTeste}
                    onChange={(e) => setDestinoTeste(e.target.value)}
                    className="h-11"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={testando || carregando || !destinoTeste || !config?.configurado}
                  onClick={handleTestar}
                >
                  <Send className="size-3.5" aria-hidden />
                  {testando ? "Enviando..." : "Enviar teste"}
                </Button>
              </div>
              {!config?.configurado && (
                <p className="text-xs text-muted-foreground">Salve o servidor antes de testar.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </AnimatedPage>
    </AppShell>
  );
}
