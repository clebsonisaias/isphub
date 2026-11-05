import { useEffect, useState, type FormEvent } from "react";
import {
  AREAS,
  PAPEIS_DA_EQUIPE,
  UserRole,
  USER_ROLE_LABEL,
  escopadoPorProvedor,
  normalizarPermissoes,
  type AreaId,
  type PermissoesGestor,
  type Provedor,
  type UsuarioPublic,
} from "@isphub/shared";
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
import { useAuth, usePodeEditar } from "@/context/AuthContext";
import { AvisoSoVer } from "@/components/AvisoSoVer";
import { ApiError } from "@/lib/apiClient";
import { limitesDoFormulario, resumoLimites } from "@/lib/limitesGestor";
import { useToast } from "@/context/ToastContext";
import { Plus, Pencil, KeyRound, Smartphone } from "lucide-react";

/** Cadastrado pelo robo/SGP sem acesso: e-mail placeholder e senha que ninguem sabe. */
const semAcesso = (u: UsuarioPublic) => u.email.endsWith("@sem-login.isphub.invalid");

import { VincularLinhaDialog } from "@/components/linha-movel/VincularLinhaDialog";
import { CredencialLinhaMovelDialog } from "@/components/linha-movel/CredencialLinhaMovelDialog";

const AREA_IDS = Object.keys(AREAS) as AreaId[];

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/**
 * `equipe`: a mesma tela em /equipe, pro supervisor cadastrar a propria equipe
 * (tecnico, atendente, vendedor). Sem o menu do admin, sem telefonia movel e
 * sem os limites do gestor — tudo isso e so do admin, e a API recusa o resto.
 */
export function UsuariosPage({ equipe = false }: { equipe?: boolean }) {
  const { usuario: eu } = useAuth();
  const { toast } = useToast();
  // Supervisor com a area Equipe so em "ver": lista, sem cadastrar nem editar.
  const podeEditar = usePodeEditar("equipe");
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

  // A API ja filtra a equipe do gestor; o filtro aqui e pro admin que abrir /equipe.
  const lista = equipe ? usuarios.filter((u) => PAPEIS_DA_EQUIPE.includes(u.role)) : usuarios;

  return (
    <AppShell>
      <AnimatedPage>
      {equipe ? null : <AdminNav />}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{equipe ? "Equipe" : "Usuários"}</h1>
          <p className="text-sm text-muted-foreground">
            {equipe
              ? "Técnicos (cada um vê só as OS atribuídas a ele), atendentes (marcam visitas no provedor delas) e vendedores."
              : "Administradores, gestores, técnicos (login próprio — cada um vê só as OS atribuídas a ele), atendentes (marcam visitas no provedor delas) e provedores."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {equipe ? null : (
            <Button variant="outline" onClick={() => setCredencialAberta(true)}>
              <Smartphone className="size-4" /> Telefonia móvel
            </Button>
          )}
          {podeEditar ? (
            <Button variant="brand" onClick={abrirNovo}>
              <Plus /> Novo usuário
            </Button>
          ) : null}
        </div>
      </div>
      {podeEditar ? null : (
        <div className="mb-4">
          <AvisoSoVer />
        </div>
      )}

      {carregando ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="Nenhum usuário cadastrado ainda" />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {lista.map((u) => (
            <Card key={u.id} className={u.ativo ? undefined : "opacity-60"}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate text-base">{u.nome}</CardTitle>
                  <CardDescription className="truncate">
                    {semAcesso(u) ? "sem acesso ao sistema" : u.email} · {USER_ROLE_LABEL[u.role]}
                    {escopadoPorProvedor(u.role) ? ` · ${nomeProvedor(u.provedorId)}` : ""}
                    {u.role === UserRole.GESTOR ? ` · ${resumoLimites(u.provedoresPermitidos, u.permissoes, nomeProvedor)}` : ""}
                    {!u.ativo && " · inativo"}
                  </CardDescription>
                </div>
                <Switch
                  checked={u.ativo}
                  onCheckedChange={() => handleToggleAtivo(u)}
                  disabled={u.id === eu?.id || !podeEditar}
                  title={u.id === eu?.id ? "Você não pode desativar sua própria conta" : "Ativo"}
                />
                {equipe ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setLinhaAlvo(u)}
                    title="Linha móvel (chip corporativo)"
                  >
                    <Smartphone className="size-4" />
                  </Button>
                )}
                {!podeEditar ? null : semAcesso(u) ? (
                  <Button variant="outline" size="sm" onClick={() => setSenhaAlvo(u)}>
                    <KeyRound className="size-4" /> Liberar acesso
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" onClick={() => setSenhaAlvo(u)} title="Redefinir senha">
                    <KeyRound className="size-4" />
                  </Button>
                )}
                {podeEditar ? (
                  <Button variant="ghost" size="icon" onClick={() => abrirEdicao(u)} title="Editar">
                    <Pencil className="size-4" />
                  </Button>
                ) : null}
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
        defineLimites={!equipe && eu?.role === UserRole.ADMIN}
        papeis={equipe ? PAPEIS_DA_EQUIPE : Object.values(UserRole)}
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
      {equipe ? null : (
        <>
          <VincularLinhaDialog usuario={linhaAlvo} onFechar={() => setLinhaAlvo(null)} />
          <CredencialLinhaMovelDialog
            aberto={credencialAberta}
            aoFechar={() => setCredencialAberta(false)}
          />
        </>
      )}
      </AnimatedPage>
    </AppShell>
  );
}

function UsuarioDialog({
  aberto,
  onOpenChange,
  usuario,
  provedores,
  defineLimites,
  papeis,
  onSalvo,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  usuario: UsuarioPublic | null;
  provedores: Provedor[];
  /** Quem edita e ADMIN: so ele define os limites do supervisor (a API recusa o resto). */
  defineLimites: boolean;
  /** Papeis do seletor: o supervisor so cadastra a equipe (a API recusa o resto). */
  papeis: UserRole[];
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const editando = !!usuario;
  // Limites do supervisor. Os "mexeu" decidem o que vai no PUT: campo que o
  // admin nao tocou nao viaja (ver limitesDoFormulario).
  const [provedoresPermitidos, setProvedoresPermitidos] = useState<string[]>([]);
  const [acessoTotal, setAcessoTotal] = useState(true);
  const [areas, setAreas] = useState<PermissoesGestor>({});
  const [mexeuProvedores, setMexeuProvedores] = useState(false);
  const [mexeuAreas, setMexeuAreas] = useState(false);

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
    const perm = normalizarPermissoes(usuario?.permissoes ?? null);
    setProvedoresPermitidos(usuario?.provedoresPermitidos ?? []);
    setAcessoTotal(perm === null);
    setAreas(perm ?? {});
    setMexeuProvedores(false);
    setMexeuAreas(false);
  }, [aberto, usuario]);

  const limites = defineLimites
    ? limitesDoFormulario({ role, mexeuProvedores, mexeuAreas, provedores: provedoresPermitidos, acessoTotal, areas })
    : {};

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
          ...limites,
        });
        toast({ titulo: "Usuário atualizado", variante: "sucesso" });
      } else {
        await usuariosApi.criar({
          nome,
          email,
          senha,
          role,
          provedorId: escopadoPorProvedor(role) ? provedorId || null : null,
          ...limites,
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
      <DialogContent className="max-h-[90svh] max-w-lg overflow-y-auto">
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
              {papeis.map((r) => (
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
          {defineLimites && role === UserRole.GESTOR && (
            <>
              <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <legend className="px-1 text-sm font-medium">Provedores</legend>
                {provedores.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={provedoresPermitidos.includes(p.id)}
                      onChange={(e) => {
                        setMexeuProvedores(true);
                        setProvedoresPermitidos((atual) =>
                          e.target.checked ? [...atual, p.id] : atual.filter((id) => id !== p.id),
                        );
                      }}
                    />
                    {p.nome}
                  </label>
                ))}
                {provedoresPermitidos.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum marcado: vê todos os provedores</p>
                )}
              </fieldset>
              <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <legend className="px-1 text-sm font-medium">Áreas</legend>
                <div className="flex items-center gap-2">
                  <Switch
                    id="acessoTotal"
                    checked={acessoTotal}
                    onCheckedChange={(v) => {
                      setMexeuAreas(true);
                      setAcessoTotal(v);
                    }}
                  />
                  <Label htmlFor="acessoTotal">Acesso total (como hoje)</Label>
                </div>
                {!acessoTotal &&
                  AREA_IDS.map((a) => (
                    <div key={a} className="flex items-center justify-between gap-3">
                      <Label htmlFor={`area-${a}`} className="font-normal">
                        {AREAS[a].rotulo}
                      </Label>
                      <Select
                        id={`area-${a}`}
                        value={areas[a] ?? ""}
                        onChange={(e) => {
                          setMexeuAreas(true);
                          const nivel = e.target.value as "" | "ver" | "editar";
                          setAreas((atual) => {
                            const prox = { ...atual };
                            if (nivel) prox[a] = nivel;
                            else delete prox[a];
                            return prox;
                          });
                        }}
                        className="w-32 bg-secondary/40 px-2"
                      >
                        <option value="">Nenhum</option>
                        {/* O chat nao tem "ver": ler sem poder responder nao serve. */}
                        {!AREAS[a].soEditar && <option value="ver">Ver</option>}
                        <option value="editar">Editar</option>
                      </Select>
                    </div>
                  ))}
                {!acessoTotal && Object.keys(areas).length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma área: o supervisor só abre o próprio perfil.</p>
                )}
              </fieldset>
            </>
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
