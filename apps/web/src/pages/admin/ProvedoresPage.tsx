import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Provedor } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { Plus, Settings } from "lucide-react";

const CORES_SUGERIDAS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4", "#ef4444"];

export function ProvedoresPage() {
  const { toast } = useToast();
  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [dialogAberto, setDialogAberto] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      setProvedores(await provedoresApi.listar());
    } catch (err) {
      toast({ titulo: "Erro ao carregar provedores", descricao: mensagem(err), variante: "erro" });
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Provedores</h1>
          <p className="text-sm text-muted-foreground">
            Cada provedor tem sua propria integracao com o ERP (SGP) e catalogo de tipos de OS.
          </p>
        </div>
        <NovoProvedorDialog
          aberto={dialogAberto}
          onOpenChange={setDialogAberto}
          onCriado={() => {
            setDialogAberto(false);
            void carregar();
          }}
        />
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : provedores.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum provedor cadastrado ainda. Clique em "Novo provedor" para comecar.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {provedores.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: p.cor }} />
                <div className="flex-1">
                  <CardTitle className="text-base">{p.nome}</CardTitle>
                  <CardDescription>{p.ativo ? "Ativo" : "Inativo"}</CardDescription>
                </div>
                <Button asChild variant="ghost" size="icon" title="Configurar">
                  <Link to={`/admin/provedores/${p.id}`}>
                    <Settings />
                  </Link>
                </Button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function NovoProvedorDialog({
  aberto,
  onOpenChange,
  onCriado,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  onCriado: () => void;
}) {
  const { toast } = useToast();
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(CORES_SUGERIDAS[0]);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await provedoresApi.criar({ nome, cor });
      toast({ titulo: "Provedor criado", variante: "sucesso" });
      setNome("");
      onCriado();
    } catch (err) {
      toast({ titulo: "Erro ao criar provedor", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="brand">
          <Plus /> Novo provedor
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo provedor</DialogTitle>
          <DialogDescription>Cadastre um provedor de internet atendido pela ISPhub.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nome">Nome</Label>
            <Input id="nome" required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Provedor Norte Telecom" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Cor de destaque</Label>
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
          <DialogFooter>
            <Button type="submit" variant="brand" disabled={enviando}>
              {enviando ? "Criando..." : "Criar provedor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}
