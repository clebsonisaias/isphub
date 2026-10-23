import { useEffect, useState, type FormEvent } from "react";
import { UserRole, USER_ROLE_LABEL, escopadoPorProvedor, type Provedor, type UsuarioPublic } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AdminNav } from "@/components/admin/AdminNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usuariosApi, provedoresApi } from "@/lib/adminApi";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { Plus, Pencil, KeyRound, Smartphone } from "lucide-react";

/** Cadastrado pelo robo/SGP sem acesso: e-mail placeholder e senha que ninguem sabe. */
const semAcesso = (u: UsuarioPublic) => u.email.endsWith("@sem-login.isphub.invalid");

import { VincularLinhaDialog } from "@/components/linha-movel/VincularLinhaDialog";
import { CredencialLinhaMovelDialog } from "@/components/linha-movel/CredencialLinhaMovelDialog";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

export function UsuariosPage() {
  const { usuario: eu } = useAuth();
  const { toast } = useToast();
  const [usuarios, setUsuarios] = useState<UsuarioPublic[]>([]);
  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<UsuarioPublic | null>(null);
  const [senhaAlvo, setSenhaAlvo] = useState<UsuarioPublic | null>(null);
  /** Vínculo do chip corporativo — o CPF é digitado ali e não é guardado. */
  const [linhaAlvo, setLinhaAlvo] = useState<UsuarioPublic | null>(null);
  const [credencialAberta, setCredencialAberta] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const [u, p] = await Promise.all([usuariosApi.listar(), provedoresApi.listar()]);
      setUsuarios(u);
      setProvedores(p);
    } catch (err) {
      toast({ titulo: "Erro ao carregar usuários", descricao: mensagem(err), variante: "erro" });
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  function abrirNovo() {
    setEditando(null);
    setDialogAberto(true);
  }

  function abrirEdicao(u: UsuarioPublic) {
    setEditando(u);
    setDialogAberto(true);
  }

  async function handleToggleAtivo(u: UsuarioPublic) {
    const ativo = !u.ativo;
    setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, ativo } : x)));
    try {
      await usuariosApi.atualizar(u.id, { nome: u.nome, email: u.email, role: u.role, provedorId: u.provedorId, ativo });
    } catch (err) {
      toast({ titulo: "Erro ao atualizar usuário", descricao: mensagem(err), variante: "erro" });
      void carregar();
    }
  }

  function nomeProvedor(id?: string | null): string {
    return provedores.find((p) => p.id === id)?.nome ?? "—";
  }

  return (
    <AppShell>
      <AnimatedPage>
      <AdminNav />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Administradores, gestores, técnicos (login próprio — cada um vê só as OS atribuídas a ele), atendentes
            (marcam visitas no provedor delas) e provedores.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCredencialAberta(true)}>
            <Smartphone className="size-4" /> Telefonia móvel
          </Button>
          <Button variant="brand" onClick={abrirNovo}>
            <Plus /> Novo usuário
          </Button>
        </div>
      </div>

      {carregando ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : usuarios.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="Nenhum usuário cadastrado ainda" />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {usuarios.map((u) => (
            <Card key={u.id} className={u.ativo ? undefined : "opacity-60"}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate text-base">{u.nome}</CardTitle>
                  <CardDescription className="truncate">
                    {semAcesso(u) ? "sem acesso ao sistema" : u.email} · {USER_ROLE_LABEL[u.role]}
                    {escopadoPorProvedor(u.role) ? ` · ${nomeProvedor(u.provedorId)}` : ""}
                    {!u.ativo && " · inativo"}
                  </CardDescription>
                </div>
                <Switch
                  checked={u.ativo}
                  onCheckedChange={() => handleToggleAtivo(u)}
                  disabled={u.id === eu?.id}
                  title={u.id === eu?.id ? "Você não pode desativar sua própria conta" : "Ativo"}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLinhaAlvo(u)}
                  title="Linha móvel (chip corporativo)"
                >
                  <Smartphone className="size-4" />
                </Button>
                {semAcesso(u) ? (
                  <Button variant="outline" size="sm" onClick={() => setSenhaAlvo(u)}>
                    <KeyRound className="size-4" /> Liberar acesso
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" onClick={() => setSenhaAlvo(u)} title="Redefinir senha">
                    <KeyRound className="size-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => abrirEdicao(u)} title="Editar">
                  <Pencil className="size-4" />
                </Button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <UsuarioDialog
        aberto={dialogAberto}
        onOpenChange={setDialogAberto}
        usuario={editando}
        provedores={provedores}
        onSalvo={() => {
          setDialogAberto(false);
          void carregar();
        }}
      />
      <RedefinirSenhaDialog
        usuario={senhaAlvo}
        onClose={() => setSenhaAlvo(null)}
        onSalvo={() => void carregar()}
      />
      <VincularLinhaDialog usuario={linhaAlvo} onFechar={() => setLinhaAlvo(null)} />
      <CredencialLinhaMovelDialog
        aberto={credencialAberta}
        aoFechar={() => setCredencialAberta(false)}
      />
      </AnimatedPage>
    </AppShell>
  );
}

function UsuarioDialog({
  aberto,
  onOpenChange,
  usuario,
  provedores,
  onSalvo,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  usuario: UsuarioPublic | null;
  provedores: Provedor[];
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const editando = !!usuario;

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState<UserRole>(UserRole.TECNICO);
  const [provedorId, setProvedorId] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setNome(usuario?.nome ?? "");
    setEmail(usuario?.email ?? "");
    setSenha("");
    setRole(usuario?.role ?? UserRole.TECNICO);
    setProvedorId(usuario?.provedorId ?? "");
    setAtivo(usuario?.ativo ?? true);
  }, [aberto, usuario]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      if (usuario) {
        await usuariosApi.atualizar(usuario.id, {
          nome,
          email,
          role,
          provedorId: escopadoPorProvedor(role) ? provedorId || null : null,
          ativo,
        });
        toast({ titulo: "Usuário atualizado", variante: "sucesso" });
      } else {
        await usuariosApi.criar({
          nome,
          email,
          senha,
          role,
          provedorId: escopadoPorProvedor(role) ? provedorId || null : null,
        });
        toast({ titulo: "Usuário criado", variante: "sucesso" });
      }
      onSalvo();
    } catch (err) {
      toast({ titulo: "Erro ao salvar usuário", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

  const invalido = !nome.trim() || !email.trim() || (escopadoPorProvedor(role) && !provedorId) || (!editando && senha.length < 8);

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar usuário" : "Novo usuário"}</DialogTitle>
          <DialogDescription>
            {editando
              ? "Altere os dados do usuário."
              : 'Defina uma senha inicial — a pessoa pode trocá-la depois em "Meu perfil".'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome">Nome</Label>
            <Input id="nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {!editando && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="senha">Senha inicial</Label>
              <Input
                id="senha"
                type="password"
                required
                minLength={8}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="role">Papel</Label>
            <Select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="bg-secondary/40 px-2"
            >
              {Object.values(UserRole).map((r) => (
                <option key={r} value={r}>
                  {USER_ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </div>
          {escopadoPorProvedor(role) && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="provedor">Provedor</Label>
              <Select
                id="provedor"
                required
                value={provedorId}
                onChange={(e) => setProvedorId(e.target.value)}
                className="bg-secondary/40 px-2"
              >
                <option value="">Selecione...</option>
                {provedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {editando && (
            <div className="flex items-center gap-2">
              <Switch checked={ativo} onCheckedChange={setAtivo} id="ativo" />
              <Label htmlFor="ativo">Ativo</Label>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" variant="brand" disabled={enviando || invalido}>
              {enviando ? "Salvando..." : editando ? "Salvar" : "Criar usuário"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Redefinir senha — ou, para quem foi cadastrado sem acesso (robo da planilha,
 * aba do SGP), "Liberar acesso": e-mail de verdade + senha inicial, de uma vez.
 */
function RedefinirSenhaDialog({
  usuario,
  onClose,
  onSalvo,
}: {
  usuario: UsuarioPublic | null;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const [novaSenha, setNovaSenha] = useState("");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const liberar = !!usuario && semAcesso(usuario);

  useEffect(() => {
    setNovaSenha("");
    setEmail("");
  }, [usuario]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!usuario) return;
    setEnviando(true);
    try {
      if (liberar) {
        await usuariosApi.atualizar(usuario.id, {
          nome: usuario.nome,
          email: email.trim(),
          role: usuario.role,
          provedorId: usuario.provedorId,
          ativo: true,
        });
      }
      await usuariosApi.redefinirSenha(usuario.id, novaSenha);
      toast({ titulo: liberar ? `Acesso de ${usuario.nome} liberado` : `Senha de ${usuario.nome} redefinida`, variante: "sucesso" });
      if (liberar) onSalvo();
      onClose();
    } catch (err) {
      toast({ titulo: "Erro ao redefinir senha", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={!!usuario} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{liberar ? "Liberar acesso" : "Redefinir senha"}</DialogTitle>
          <DialogDescription>
            {liberar
              ? `${usuario?.nome} foi cadastrado(a) sem acesso. Informe o e-mail de login e uma senha inicial — repasse à pessoa; ela pode trocar depois em "Meu perfil".`
              : `Nova senha para ${usuario?.nome}. Repasse à pessoa — ela pode trocar depois em "Meu perfil".`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {liberar ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="emailAcesso">E-mail de login</Label>
              <Input
                id="emailAcesso"
                type="email"
                required
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@empresa.com.br"
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="novaSenha">{liberar ? "Senha inicial" : "Nova senha"}</Label>
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
          <DialogFooter>
            <Button
              type="submit"
              variant="brand"
              disabled={enviando || novaSenha.length < 8 || (liberar && !email.includes("@"))}
            >
              {enviando ? "Salvando..." : liberar ? "Liberar acesso" : "Redefinir senha"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
