import { useEffect, useState } from "react";
import type { ModuloId } from "@isphub/shared";
import { USER_ROLE_LABEL } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AdminNav } from "@/components/admin/AdminNav";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { modulosApi, type ModuloAdmin } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { LayoutList, Camera, Route, Wifi, PenLine, PackageX, Bell, Router, Lock, ChevronUp, ChevronDown, type LucideIcon } from "lucide-react";

const ICONES: Record<ModuloId, LucideIcon> = {
  "minhas-os": LayoutList,
  evidencias: Camera,
  rota: Route,
  conexao: Wifi,
  provisionamento: Router,
  assinatura: PenLine,
  retiradas: PackageX,
  notificacoes: Bell,
};

const DESCRICOES: Record<ModuloId, string> = {
  "minhas-os": "Fila pessoal do técnico — não pode ser desligada",
  evidencias: "Fotos pela câmera → proxy SGP, fila offline",
  rota: "Mapa e navegação até o cliente",
  conexao: "ONU rx/tx, OLT, online/offline ao vivo",
  provisionamento: "Autorizar/desautorizar ONU na OLT (FTTX)",
  assinatura: "Coleta de assinatura no fim da OS",
  retiradas: "Fila de retirada/cancelamento (equipe externa)",
  notificacoes: "Nova OS atribuída · mudança relevante",
};

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

export function ModulosPage() {
  const { toast } = useToast();
  const [modulos, setModulos] = useState<ModuloAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    try {
      setModulos(await modulosApi.listar());
    } catch (err) {
      toast({ titulo: "Erro ao carregar módulos", descricao: mensagem(err), variante: "erro" });
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => {
    void carregar();
  }, []);

  async function alternar(m: ModuloAdmin, ativo: boolean) {
    // Otimista: reflete na hora, reverte se o servidor recusar (ex.: core → 422).
    setModulos((prev) => prev.map((x) => (x.id === m.id ? { ...x, ativo } : x)));
    try {
      await modulosApi.atualizar(m.id, { ativo });
    } catch (err) {
      setModulos((prev) => prev.map((x) => (x.id === m.id ? { ...x, ativo: m.ativo } : x)));
      toast({ titulo: "Não foi possível alterar", descricao: mensagem(err), variante: "erro" });
    }
  }

  async function mover(index: number, dir: -1 | 1) {
    const outro = index + dir;
    if (outro < 0 || outro >= modulos.length) return;
    const a = modulos[index];
    const b = modulos[outro];
    setModulos((prev) => {
      const copia = [...prev];
      [copia[index], copia[outro]] = [copia[outro], copia[index]];
      return copia;
    });
    try {
      await Promise.all([modulosApi.atualizar(a.id, { ordem: b.ordem }), modulosApi.atualizar(b.id, { ordem: a.ordem })]);
      await carregar();
    } catch (err) {
      toast({ titulo: "Não foi possível reordenar", descricao: mensagem(err), variante: "erro" });
      void carregar();
    }
  }

  return (
    <AppShell>
      <AnimatedPage>
      <AdminNav />
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Módulos do app</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Ligue ou desligue funções do app do técnico. O que estiver desligado some da navegação no aparelho — sem tela
          vazia nem botão morto. Arraste pela ordem com as setas.
        </p>
      </div>

      {carregando ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {modulos.map((m, i) => {
            const Icone = ICONES[m.id] ?? LayoutList;
            return (
              <Card key={m.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => mover(i, -1)}
                      disabled={i === 0}
                      className="text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
                      aria-label="Mover para cima"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      disabled={i === modulos.length - 1}
                      className="text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
                      aria-label="Mover para baixo"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                  </div>

                  <div
                    className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${m.ativo ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}
                  >
                    <Icone className="size-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${m.ativo ? "text-foreground" : "text-muted-foreground"}`}>{m.nome}</span>
                      {m.core && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                          <Lock className="size-2.5" />
                          Core
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{DESCRICOES[m.id]}</p>
                  </div>

                  <div className="hidden shrink-0 gap-1 sm:flex">
                    {m.rolesPermitidos.map((r) => (
                      <span key={r} className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-xs text-muted-foreground">
                        {USER_ROLE_LABEL[r]}
                      </span>
                    ))}
                  </div>

                  <Switch
                    checked={m.ativo}
                    disabled={m.core}
                    onCheckedChange={(v) => alternar(m, v)}
                    aria-label={`${m.ativo ? "Desativar" : "Ativar"} ${m.nome}`}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      </AnimatedPage>
    </AppShell>
  );
}
