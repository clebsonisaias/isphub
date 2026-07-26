import { useEffect, useState, type FormEvent } from "react";
import { UserRole, USER_ROLE_LABEL, type Provedor, type UsuarioPublic } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AdminNav } from "@/components/admin/AdminNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Plus, Pencil, KeyRound } from "lucide-react";

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
      <AdminNav />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Administradores, gestores, técnicos (login próprio — cada um vê só as OS atribuídas a ele) e provedores.
          </p>
        </div>
        <Button variant="brand" onClick={abrirNovo}>
          <Plus /> Novo usuário
        </Button>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : usuarios.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum usuário cadastrado ainda.
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
                    {u.email} · {USER_ROLE_LABEL[u.role]}
                    {u.role === UserRole.PROVEDOR ? ` · ${nomeProvedor(u.provedorId)}` : ""}
                    {!u.ativo && " · inativo"}
                  </CardDescription>
                </div>
                <Switch
                  checked={u.ativo}
                  onCheckedChange={() => handleToggleAtivo(u)}
                  disabled={u.id === eu?.id}
                  title={u.id === eu?.id ? "Você não pode desativar sua própria conta" : "Ativo"}
                />
                <Button variant="ghost" size="icon" onClick={() => setSenhaAlvo(u)} title="Redefinir senha">
                  <KeyRound className="size-4" />
                </Button>
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
      <RedefinirSenhaDialog usuario={senhaAlvo} onClose={() => setSenhaAlvo(null)} />
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
          provedorId: role === UserRole.PROVEDOR ? provedorId || null : null,
          ativo,
        });
        toast({ titulo: "Usuário atualizado", variante: "sucesso" });
      } else {
        await usuariosApi.criar({
          nome,
          email,
          senha,
          role,
          provedorId: role === UserRole.PROVEDOR ? provedorId || null : null,
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

  const invalido = !nome.trim() || !email.trim() || (role === UserRole.PROVEDOR && !provedorId) || (!editando && senha.length < 8);

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
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="h-9 rounded-md border border-input bg-secondary/40 px-2 text-sm"
            >
              {Object.values(UserRole).map((r) => (
                <option key={r} value={r}>
                  {USER_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          {role === UserRole.PROVEDOR && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="provedor">Provedor</Label>
              <select
                id="provedor"
                required
                value={provedorId}
                onChange={(e) => setProvedorId(e.target.value)}
                className="h-9 rounded-md border border-input bg-secondary/40 px-2 text-sm"
              >
                <option value="">Selecione...</option>
                {provedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
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

function RedefinirSenhaDialog({ usuario, onClose }: { usuario: UsuarioPublic | null; onClose: () => void }) {
  const { toast } = useToast();
  const [novaSenha, setNovaSenha] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setNovaSenha("");
  }, [usuario]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!usuario) return;
    setEnviando(true);
    try {
      await usuariosApi.redefinirSenha(usuario.id, novaSenha);
      toast({ titulo: `Senha de ${usuario.nome} redefinida`, variante: "sucesso" });
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
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>
            Nova senha para {usuario?.nome}. Repasse à pessoa — ela pode trocar depois em "Meu perfil".
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          <DialogFooter>
            <Button type="submit" variant="brand" disabled={enviando || novaSenha.length < 8}>
              {enviando ? "Salvando..." : "Redefinir senha"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
