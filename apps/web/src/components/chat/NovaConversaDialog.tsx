import { useEffect, useState } from "react";
import type { ContatoChat, ConversaResumo, FilaItem } from "@isphub/shared";
import { UserRole } from "@isphub/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { chatApi, type ContatoAtendai } from "@/lib/chatApi";
import { filaApi } from "@/lib/filaApi";
import { ApiError } from "@/lib/apiClient";
import { Loader2 } from "lucide-react";

function mensagemErro(err: unknown): string {
  return err instanceof ApiError
    ? err.message
    : "Falha ao comunicar com o servidor";
}

export function NovaConversaDialog({
  open,
  onOpenChange,
  onConversaCriada,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConversaCriada: (conversa: ConversaResumo) => void;
}) {
  const { usuario } = useAuth();
  const { toast } = useToast();
  const podeCriarGrupo =
    usuario?.role === UserRole.ADMIN || usuario?.role === UserRole.GESTOR;

  const [contatos, setContatos] = useState<ContatoChat[] | null>(null);
  // Atendentes do AtendAI (provedores com o chat ligado). Vazio quando nenhum ligou.
  const [atendentes, setAtendentes] = useState<ContatoAtendai[]>([]);
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const [criandoId, setCriandoId] = useState<string | null>(null);

  const [selecionadosGrupo, setSelecionadosGrupo] = useState<Set<string>>(
    new Set(),
  );
  const [tituloGrupo, setTituloGrupo] = useState("");
  const [criandoGrupo, setCriandoGrupo] = useState(false);

  const [buscaOs, setBuscaOs] = useState("");
  const [resultadosOs, setResultadosOs] = useState<FilaItem[]>([]);
  const [buscandoOs, setBuscandoOs] = useState(false);
  const [abrindoOsId, setAbrindoOsId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBuscaPessoa("");
    setBuscaOs("");
    setResultadosOs([]);
    setSelecionadosGrupo(new Set());
    setTituloGrupo("");
    chatApi
      .contatos()
      .then(setContatos)
      .catch(() => setContatos([]));
    chatApi
      .contatosAtendai()
      .then(setAtendentes)
      .catch(() => setAtendentes([]));
  }, [open]);

  useEffect(() => {
    if (!open || buscaOs.trim().length < 2) {
      setResultadosOs([]);
      return;
    }
    let cancelado = false;
    setBuscandoOs(true);
    const t = setTimeout(() => {
      filaApi
        .listar({ busca: buscaOs.trim(), grupo: "abertos" })
        .then((r) => !cancelado && setResultadosOs(r.itens.slice(0, 8)))
        .catch(() => !cancelado && setResultadosOs([]))
        .finally(() => !cancelado && setBuscandoOs(false));
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [buscaOs, open]);

  const contatosFiltrados = (contatos ?? []).filter((c) =>
    c.nome.toLowerCase().includes(buscaPessoa.trim().toLowerCase()),
  );
  const atendentesFiltrados = atendentes.filter((a) =>
    a.nome.toLowerCase().includes(buscaPessoa.trim().toLowerCase()),
  );
  const variosProvedores = new Set(atendentes.map((a) => a.provedorId)).size > 1;

  async function handleAbrirAtendente(a: ContatoAtendai) {
    setCriandoId(`atendai:${a.provedorId}:${a.colaboradorId}`);
    try {
      const conversa = await chatApi.conversaComAtendente(a);
      onConversaCriada(conversa);
      onOpenChange(false);
    } catch (err) {
      toast({
        titulo: "Não foi possível abrir a conversa",
        descricao: mensagemErro(err),
        variante: "erro",
      });
    } finally {
      setCriandoId(null);
    }
  }

  async function handleAbrirDireta(c: ContatoChat) {
    setCriandoId(c.id);
    try {
      const conversa = await chatApi.criarDireta(c.id);
      onConversaCriada(conversa);
      onOpenChange(false);
    } catch (err) {
      toast({
        titulo: "Não foi possível abrir a conversa",
        descricao: mensagemErro(err),
        variante: "erro",
      });
    } finally {
      setCriandoId(null);
    }
  }

  function toggleSelecionado(id: string) {
    setSelecionadosGrupo((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  async function handleCriarGrupo() {
    if (!tituloGrupo.trim() || selecionadosGrupo.size === 0) return;
    setCriandoGrupo(true);
    try {
      const conversa = await chatApi.criarGrupo(
        tituloGrupo.trim(),
        Array.from(selecionadosGrupo),
      );
      onConversaCriada(conversa);
      onOpenChange(false);
    } catch (err) {
      toast({
        titulo: "Não foi possível criar o grupo",
        descricao: mensagemErro(err),
        variante: "erro",
      });
    } finally {
      setCriandoGrupo(false);
    }
  }

  async function handleAbrirOs(item: FilaItem) {
    setAbrindoOsId(item.id);
    try {
      const conversa = await chatApi.garantirConversaDeOs(item.id);
      onConversaCriada(conversa);
      onOpenChange(false);
    } catch (err) {
      toast({
        titulo: "Não foi possível abrir a conversa da OS",
        descricao: mensagemErro(err),
        variante: "erro",
      });
    } finally {
      setAbrindoOsId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="pessoas">
          <TabsList className="w-full">
            <TabsTrigger value="pessoas" className="flex-1">
              Pessoas
            </TabsTrigger>
            {podeCriarGrupo && (
              <TabsTrigger value="grupo" className="flex-1">
                Grupo
              </TabsTrigger>
            )}
            <TabsTrigger value="os" className="flex-1">
              OS
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pessoas">
            <Input
              placeholder="Buscar por nome…"
              value={buscaPessoa}
              onChange={(e) => setBuscaPessoa(e.target.value)}
            />
            <div className="mt-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
              {contatos === null ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Carregando…
                </p>
              ) : contatosFiltrados.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Ninguém encontrado.
                </p>
              ) : (
                contatosFiltrados.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={criandoId === c.id}
                    onClick={() => handleAbrirDireta(c)}
                    className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary disabled:opacity-50"
                  >
                    <Avatar nome={c.nome} online={c.online} size="sm" />
                    <span className="text-sm text-foreground">{c.nome}</span>
                    {criandoId === c.id && (
                      <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
              {atendentesFiltrados.length > 0 ? (
                <>
                  <p className="mt-3 px-2 pb-1 text-xs font-medium text-muted-foreground">Atendimento (AtendAI)</p>
                  {atendentesFiltrados.map((a) => {
                    const chave = `atendai:${a.provedorId}:${a.colaboradorId}`;
                    return (
                      <button
                        key={chave}
                        type="button"
                        disabled={criandoId === chave}
                        onClick={() => handleAbrirAtendente(a)}
                        className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary disabled:opacity-50"
                      >
                        <Avatar nome={a.nome} size="sm" />
                        <span className="text-sm text-foreground">{a.nome}</span>
                        {variosProvedores ? <span className="text-xs text-muted-foreground">{a.provedorNome}</span> : null}
                        {criandoId === chave && (
                          <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />
                        )}
                      </button>
                    );
                  })}
                </>
              ) : null}
            </div>
          </TabsContent>

          {podeCriarGrupo && (
            <TabsContent value="grupo">
              <Input
                placeholder="Nome do grupo"
                value={tituloGrupo}
                onChange={(e) => setTituloGrupo(e.target.value)}
              />
              <div className="mt-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {(contatos ?? []).map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={selecionadosGrupo.has(c.id)}
                      onChange={() => toggleSelecionado(c.id)}
                      className="size-4 accent-primary"
                    />
                    <Avatar nome={c.nome} size="sm" />
                    <span className="text-sm text-foreground">{c.nome}</span>
                  </label>
                ))}
              </div>
              <Button
                type="button"
                variant="brand"
                className="mt-3 w-full"
                disabled={
                  !tituloGrupo.trim() ||
                  selecionadosGrupo.size === 0 ||
                  criandoGrupo
                }
                onClick={handleCriarGrupo}
              >
                Criar grupo
              </Button>
            </TabsContent>
          )}

          <TabsContent value="os">
            <Input
              placeholder="Buscar OS por cliente, protocolo, contrato…"
              value={buscaOs}
              onChange={(e) => setBuscaOs(e.target.value)}
            />
            <div className="mt-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
              {buscandoOs && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Buscando…
                </p>
              )}
              {!buscandoOs &&
                buscaOs.trim().length >= 2 &&
                resultadosOs.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Nenhuma OS encontrada.
                  </p>
                )}
              {resultadosOs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={abrindoOsId === item.id}
                  onClick={() => handleAbrirOs(item)}
                  className="flex flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  <span className="font-mono text-xs font-semibold text-foreground">
                    OS #{item.sgpOsId}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {item.clienteNome ?? "Sem cliente"}
                  </span>
                </button>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
