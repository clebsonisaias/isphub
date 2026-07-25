import { useEffect, useState, type FormEvent } from "react";
import type { Categoria } from "@isphub/shared";
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
import { categoriasApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { CATEGORIA_ICONE_OPCOES, iconeCategoria } from "@/lib/categoriaIcons";
import { Plus, Pencil, Trash2, X } from "lucide-react";

const CORES_SUGERIDAS = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#64748b", "#06b6d4", "#ec4899"];

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

export function CategoriasPage() {
  const { toast } = useToast();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<Categoria | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      setCategorias(await categoriasApi.listar());
    } catch (err) {
      toast({ titulo: "Erro ao carregar categorias", descricao: mensagem(err), variante: "erro" });
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  function abrirNova() {
    setEditando(null);
    setDialogAberto(true);
  }

  function abrirEdicao(c: Categoria) {
    setEditando(c);
    setDialogAberto(true);
  }

  async function handleRemover(c: Categoria) {
    if (!confirm(`Remover a categoria "${c.nome}"? Se ela ainda tiver tipos vinculados, fica só inativa.`)) return;
    try {
      await categoriasApi.remover(c.id);
      toast({ titulo: "Categoria removida", variante: "sucesso" });
      void carregar();
    } catch (err) {
      toast({ titulo: "Erro ao remover categoria", descricao: mensagem(err), variante: "erro" });
    }
  }

  async function handleToggleAtivo(c: Categoria) {
    setCategorias((prev) => prev.map((x) => (x.id === c.id ? { ...x, ativo: !x.ativo } : x)));
    try {
      await categoriasApi.atualizar(c.id, { ativo: !c.ativo });
    } catch (err) {
      toast({ titulo: "Erro ao atualizar categoria", descricao: mensagem(err), variante: "erro" });
      void carregar();
    }
  }

  return (
    <AppShell>
      <AdminNav />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Categorias</h1>
          <p className="text-sm text-muted-foreground">
            Taxonomia única da ISPhub. Cada provedor nomeia os tipos de OS do seu jeito no SGP — as palavras-chave
            aqui fazem o auto-mapeamento pra essas categorias na importação e no sync.
          </p>
        </div>
        <Button variant="brand" onClick={abrirNova}>
          <Plus /> Nova categoria
        </Button>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : categorias.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma categoria cadastrada ainda.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {categorias.map((c) => {
            const Icone = iconeCategoria(c.icone);
            return (
              <Card key={c.id} className={c.ativo ? undefined : "opacity-60"}>
                <CardHeader className="flex-row items-center gap-3 space-y-0 pb-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${c.cor}22`, color: c.cor }}
                  >
                    <Icone className="size-5" />
                  </span>
                  <div className="flex-1">
                    <CardTitle className="text-base">{c.nome}</CardTitle>
                    <CardDescription>
                      {c.slaHorasPadrao ? `SLA padrão: ${c.slaHorasPadrao}h` : "Sem SLA padrão"}
                      {!c.ativo && " · inativa"}
                    </CardDescription>
                  </div>
                  <Switch checked={c.ativo} onCheckedChange={() => handleToggleAtivo(c)} title="Ativa" />
                  <Button variant="ghost" size="icon" onClick={() => abrirEdicao(c)} title="Editar">
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleRemover(c)} title="Remover">
                    <Trash2 className="size-4" />
                  </Button>
                </CardHeader>
                {c.palavrasChave.length > 0 && (
                  <CardContent className="flex flex-wrap gap-1.5 pt-0">
                    {c.palavrasChave.map((p) => (
                      <span
                        key={p}
                        className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {p}
                      </span>
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <CategoriaDialog
        aberto={dialogAberto}
        onOpenChange={setDialogAberto}
        categoria={editando}
        onSalvo={() => {
          setDialogAberto(false);
          void carregar();
        }}
      />
    </AppShell>
  );
}

function CategoriaDialog({
  aberto,
  onOpenChange,
  categoria,
  onSalvo,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  categoria: Categoria | null;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const editando = !!categoria;

  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(CORES_SUGERIDAS[0]);
  const [icone, setIcone] = useState<string | null>(null);
  const [palavras, setPalavras] = useState<string[]>([]);
  const [novaPalavra, setNovaPalavra] = useState("");
  const [slaHorasPadrao, setSlaHorasPadrao] = useState<string>("");
  const [ordem, setOrdem] = useState(0);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setNome(categoria?.nome ?? "");
    setCor(categoria?.cor ?? CORES_SUGERIDAS[0]);
    setIcone(categoria?.icone ?? null);
    setPalavras(categoria?.palavrasChave ?? []);
    setNovaPalavra("");
    setSlaHorasPadrao(categoria?.slaHorasPadrao ? String(categoria.slaHorasPadrao) : "");
    setOrdem(categoria?.ordem ?? 0);
  }, [aberto, categoria]);

  function adicionarPalavra() {
    const p = novaPalavra.trim().toLowerCase();
    if (!p || palavras.includes(p)) {
      setNovaPalavra("");
      return;
    }
    setPalavras((prev) => [...prev, p]);
    setNovaPalavra("");
  }

  function removerPalavra(p: string) {
    setPalavras((prev) => prev.filter((x) => x !== p));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const data = {
      nome,
      cor,
      icone,
      palavrasChave: palavras,
      slaHorasPadrao: slaHorasPadrao ? Number(slaHorasPadrao) : null,
      ordem,
    };
    try {
      if (editando) {
        await categoriasApi.atualizar(categoria.id, data);
        toast({ titulo: "Categoria atualizada", variante: "sucesso" });
      } else {
        await categoriasApi.criar(data);
        toast({ titulo: "Categoria criada", variante: "sucesso" });
      }
      onSalvo();
    } catch (err) {
      toast({ titulo: "Erro ao salvar categoria", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          <DialogDescription>
            Palavras-chave (sem acento, minúsculas) são usadas pra auto-classificar tipos de OS de qualquer provedor
            que contenham esse texto no nome.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome">Nome</Label>
            <Input id="nome" required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Instalação" />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {CORES_SUGERIDAS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  className="size-8 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110"
                  style={{ backgroundColor: c, boxShadow: cor === c ? `0 0 0 2px ${c}` : undefined }}
                  aria-label={`Selecionar cor ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Ícone</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIA_ICONE_OPCOES.map((nomeIcone) => {
                const Icone = iconeCategoria(nomeIcone);
                const ativo = icone === nomeIcone;
                return (
                  <button
                    key={nomeIcone}
                    type="button"
                    onClick={() => setIcone(ativo ? null : nomeIcone)}
                    className={`flex size-9 items-center justify-center rounded-md border transition-colors ${
                      ativo ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                    title={nomeIcone}
                  >
                    <Icone className="size-4" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="palavra">Palavras-chave (auto-mapeamento)</Label>
            <div className="flex gap-2">
              <Input
                id="palavra"
                value={novaPalavra}
                onChange={(e) => setNovaPalavra(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    adicionarPalavra();
                  }
                }}
                placeholder="Ex: instal, novo cliente..."
              />
              <Button type="button" variant="outline" onClick={adicionarPalavra}>
                Adicionar
              </Button>
            </div>
            {palavras.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {palavras.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-xs"
                  >
                    {p}
                    <button type="button" onClick={() => removerPalavra(p)} aria-label={`Remover ${p}`}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sla">SLA padrão (horas)</Label>
              <Input
                id="sla"
                type="number"
                min={1}
                max={720}
                value={slaHorasPadrao}
                placeholder="—"
                onChange={(e) => setSlaHorasPadrao(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ordem">Ordem</Label>
              <Input
                id="ordem"
                type="number"
                min={0}
                value={ordem}
                onChange={(e) => setOrdem(Number(e.target.value))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" variant="brand" disabled={enviando || !nome.trim()}>
              {enviando ? "Salvando..." : editando ? "Salvar" : "Criar categoria"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
