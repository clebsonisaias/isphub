import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Categoria, ErpConfigPublic, Provedor, TipoOs } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select } from "@/components/ui/select";
import { atendaiConfigApi, categoriasApi, erpConfigApi, provedoresApi, syncApi, tiposOsApi } from "@/lib/adminApi";
import type { AtendaiConfigPublic } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { ArrowLeft, CheckCircle2, Copy, Download, KeyRound, Link2, RefreshCw, Sparkles, XCircle } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

export function ProvedorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [provedor, setProvedor] = useState<Provedor | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!id) return;
    provedoresApi
      .obter(id)
      .then(setProvedor)
      .catch((err) => toast({ titulo: "Erro ao carregar provedor", descricao: mensagem(err), variante: "erro" }));
  }, [id]);

  if (!id) return null;

  return (
    <AppShell>
      <AnimatedPage>
      <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Provedores
      </Link>

      {provedor && (
        <div className="mb-6 flex items-center gap-3">
          <span className="size-3 rounded-full" style={{ backgroundColor: provedor.cor }} />
          <h1 className="text-2xl font-bold">{provedor.nome}</h1>
        </div>
      )}

      <Tabs defaultValue="sgp">
        <TabsList>
          <TabsTrigger value="sgp">Integração SGP</TabsTrigger>
          <TabsTrigger value="tipos">Tipos de OS</TabsTrigger>
          <TabsTrigger value="atendai">AtendAI</TabsTrigger>
        </TabsList>
        <TabsContent value="sgp">
          <SgpConfigForm provedorId={id} />
        </TabsContent>
        <TabsContent value="tipos">
          <TiposOsManager provedorId={id} />
        </TabsContent>
        <TabsContent value="atendai">
          <AtendaiConfigForm provedorId={id} />
        </TabsContent>
      </Tabs>
      </AnimatedPage>
    </AppShell>
  );
}

function SgpConfigForm({ provedorId }: { provedorId: string }) {
  const { toast } = useToast();
  const [config, setConfig] = useState<ErpConfigPublic | null>(null);
  const [url, setUrl] = useState("");
  const [app, setApp] = useState("");
  const [token, setToken] = useState("");
  const [intervalo, setIntervalo] = useState(180);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<{ ok: boolean; message?: string } | null>(null);

  async function carregar() {
    try {
      const c = await erpConfigApi.obter(provedorId);
      setConfig(c);
      setUrl(c.url);
      setApp(c.app);
      setIntervalo(c.intervaloPollingSegundos);
    } catch {
      // 404: ainda nao configurado — formulario fica vazio, o que e esperado
    }
  }

  useEffect(() => {
    void carregar();
  }, [provedorId]);

  async function handleSalvar() {
    setSalvando(true);
    try {
      const c = await erpConfigApi.salvar(provedorId, { url, app, token, intervaloPollingSegundos: intervalo });
      setConfig(c);
      setToken("");
      toast({ titulo: "Integração SGP salva", variante: "sucesso" });
    } catch (err) {
      toast({ titulo: "Erro ao salvar integração", descricao: mensagem(err), variante: "erro" });
    } finally {
      setSalvando(false);
    }
  }

  async function handleTestar() {
    setTestando(true);
    setResultadoTeste(null);
    try {
      const r = await erpConfigApi.testar(provedorId);
      setResultadoTeste(r);
      toast({
        titulo: r.ok ? "Conexão OK" : "Falha na conexão",
        descricao: r.message,
        variante: r.ok ? "sucesso" : "erro",
      });
      void carregar();
    } catch (err) {
      toast({ titulo: "Erro ao testar conexão", descricao: mensagem(err), variante: "erro" });
    } finally {
      setTestando(false);
    }
  }

  async function handleSincronizar() {
    setSincronizando(true);
    try {
      const r = await syncApi.disparar(provedorId);
      toast({
        titulo: r.ok ? "Sincronização concluída" : "Sincronização com falhas",
        descricao: r.message,
        variante: r.ok ? "sucesso" : "erro",
      });
    } catch (err) {
      toast({ titulo: "Erro ao sincronizar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SGP</CardTitle>
        <CardDescription>
          Credenciais de acesso ao SGP deste provedor. O token e armazenado cifrado e nunca e reexibido — para
          trocar qualquer campo, informe o token novamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {config && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Token atual:</span>
            <code className="text-xs">{config.tokenMascarado}</code>
            {config.ultimaSyncEm && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                {config.ultimaSyncOk ? (
                  <CheckCircle2 className="size-3.5 text-success" />
                ) : (
                  <XCircle className="size-3.5 text-destructive" />
                )}
                última sync: {new Date(config.ultimaSyncEm).toLocaleString("pt-BR")}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="url">URL base do SGP</Label>
            <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://exemplo.sgp.net.br" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="app">App</Label>
            <Input id="app" value={app} onChange={(e) => setApp(e.target.value)} placeholder="nome-do-app" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="intervalo">Intervalo de sync (segundos)</Label>
            <Input
              id="intervalo"
              type="number"
              min={30}
              max={3600}
              value={intervalo}
              onChange={(e) => setIntervalo(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="token">Token</Label>
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={config ? "Informe o token para atualizar" : "Token de acesso do SGP"}
            />
          </div>
        </div>

        {resultadoTeste && !resultadoTeste.ok && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {resultadoTeste.message}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="brand" onClick={handleSalvar} disabled={salvando || !url || !app || !token}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant="outline" onClick={handleTestar} disabled={testando || !config}>
            {testando ? "Testando..." : "Testar conexão"}
          </Button>
          <Button variant="outline" onClick={handleSincronizar} disabled={sincronizando || !config}>
            <RefreshCw className={sincronizando ? "animate-spin" : ""} />
            {sincronizando ? "Sincronizando..." : "Sincronizar agora"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TiposOsManager({ provedorId }: { provedorId: string }) {
  const { toast } = useToast();
  const [tipos, setTipos] = useState<TipoOs[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [importando, setImportando] = useState(false);
  const [classificando, setClassificando] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const [tiposResp, categoriasResp] = await Promise.all([tiposOsApi.listar(provedorId), categoriasApi.listar()]);
      setTipos(tiposResp);
      setCategorias(categoriasResp);
    } catch (err) {
      toast({ titulo: "Erro ao carregar tipos de OS", descricao: mensagem(err), variante: "erro" });
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, [provedorId]);

  const naoClassificados = tipos.filter((t) => !t.categoriaId).length;

  async function handleImportar() {
    setImportando(true);
    try {
      const r = await tiposOsApi.importar(provedorId);
      toast({ titulo: `${r.importados} tipo(s) importado(s) do SGP`, variante: "sucesso" });
      void carregar();
    } catch (err) {
      toast({ titulo: "Erro ao importar tipos", descricao: mensagem(err), variante: "erro" });
    } finally {
      setImportando(false);
    }
  }

  async function handleAutoClassificar() {
    setClassificando(true);
    try {
      const r = await tiposOsApi.autoClassificar(provedorId);
      toast({
        titulo: `${r.classificados} de ${r.analisados} tipo(s) classificado(s) automaticamente`,
        descricao: r.analisados - r.classificados > 0 ? "O restante segue 'Não classificado' — mapeie manualmente." : undefined,
        variante: "sucesso",
      });
      void carregar();
    } catch (err) {
      toast({ titulo: "Erro ao auto-classificar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setClassificando(false);
    }
  }

  async function atualizarTipo(tipo: TipoOs, patch: Partial<Pick<TipoOs, "visivel" | "slaHoras" | "categoriaId">>) {
    const categoria =
      "categoriaId" in patch ? (categorias.find((c) => c.id === patch.categoriaId) ?? null) : undefined;
    setTipos((prev) =>
      prev.map((t) => (t.id === tipo.id ? { ...t, ...patch, ...(categoria !== undefined ? { categoria } : {}) } : t)),
    );
    try {
      await tiposOsApi.atualizar(provedorId, tipo.id, patch);
    } catch (err) {
      toast({ titulo: "Erro ao atualizar tipo de OS", descricao: mensagem(err), variante: "erro" });
      void carregar();
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Tipos de OS</CardTitle>
          <CardDescription>
            Catalogo de tipos vindo do SGP. Mapeie cada um a uma{" "}
            <Link to="/admin/categorias" className="underline hover:text-foreground">
              categoria
            </Link>
            , controle quais aparecem no painel e ajuste o SLA quando precisar fugir do padrão da categoria.
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={handleAutoClassificar} disabled={classificando || naoClassificados === 0}>
            <Sparkles className={classificando ? "animate-pulse" : ""} />
            {classificando ? "Classificando..." : `Auto-classificar${naoClassificados ? ` (${naoClassificados})` : ""}`}
          </Button>
          <Button variant="outline" onClick={handleImportar} disabled={importando}>
            <Download className={importando ? "animate-pulse" : ""} />
            {importando ? "Importando..." : "Importar do SGP"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {carregando ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 rounded-md" />
            ))}
          </div>
        ) : tipos.length === 0 ? (
          <EmptyState
            title="Nenhum tipo importado ainda"
            description='Configure a integração SGP e clique em "Importar do SGP".'
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>SLA (horas)</TableHead>
                <TableHead>Visível</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tipos.map((tipo) => (
                <TableRow key={tipo.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{tipo.sgpCodigo}</TableCell>
                  <TableCell>{tipo.descricao}</TableCell>
                  <TableCell>
                    <Select
                      value={tipo.categoriaId ?? ""}
                      onChange={(e) => atualizarTipo(tipo, { categoriaId: e.target.value || null })}
                      className={
                        tipo.categoriaId
                          ? "bg-secondary/40 px-2"
                          : "border-warning/40 bg-warning/10 px-2 text-warning"
                      }
                    >
                      <option value="">Não classificado</option>
                      {categorias.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      max={720}
                      className="h-8 w-20"
                      value={tipo.slaHoras ?? ""}
                      placeholder={tipo.categoria?.slaHorasPadrao ? `${tipo.categoria.slaHorasPadrao}` : "—"}
                      onChange={(e) =>
                        atualizarTipo(tipo, { slaHoras: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={tipo.visivel}
                      onCheckedChange={(v) => atualizarTipo(tipo, { visivel: v })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A ligação deste provedor com o AtendAI — e ela tem DOIS sentidos.
 *
 * "Credenciais do AtendAI" é como o ISPhub fala com ele (chat, avisos ao
 * cliente). "Chave de agendamento" é o contrário: como o AtendAI entra aqui pra
 * consultar vagas e marcar visita. São segredos diferentes, gerados por lados
 * diferentes, e tratá-los como um só já quebraria na primeira rotação de chave.
 */
function AtendaiConfigForm({ provedorId }: { provedorId: string }) {
  const { toast } = useToast();
  const [config, setConfig] = useState<AtendaiConfigPublic | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [ligando, setLigando] = useState(false);
  /* A chave de entrada em claro só existe nesta variável, até sair da tela. */
  const [chaveNova, setChaveNova] = useState<string | null>(null);

  const carregar = useCallback(() => {
    atendaiConfigApi
      .obter(provedorId)
      .then((c) => {
        setConfig(c);
        if (c) setBaseUrl(c.baseUrl);
      })
      .catch((err) => toast({ titulo: "Erro ao carregar", descricao: mensagem(err), variante: "erro" }));
  }, [provedorId, toast]);

  useEffect(carregar, [carregar]);

  async function salvar() {
    setSalvando(true);
    try {
      await atendaiConfigApi.salvar(provedorId, { baseUrl, chave });
      setChave("");
      carregar();
      toast({ titulo: "Credenciais salvas", variante: "sucesso" });
    } catch (err) {
      toast({ titulo: "Não foi possível salvar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTestando(true);
    try {
      const r = await atendaiConfigApi.testar(provedorId);
      toast(
        r.ok
          ? { titulo: "Conexão OK", descricao: `${r.colaboradores ?? 0} colaborador(es)`, variante: "sucesso" }
          : { titulo: "O AtendAI recusou", descricao: r.erro, variante: "erro" },
      );
    } catch (err) {
      toast({ titulo: "Falha no teste", descricao: mensagem(err), variante: "erro" });
    } finally {
      setTestando(false);
    }
  }

  async function gerar() {
    setGerando(true);
    try {
      const { chave: nova } = await atendaiConfigApi.gerarChaveEntrada(provedorId);
      setChaveNova(nova);
      carregar();
    } catch (err) {
      toast({ titulo: "Não foi possível gerar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setGerando(false);
    }
  }

  async function ligar() {
    setLigando(true);
    try {
      const r = await atendaiConfigApi.ligarAgendamento(provedorId);
      setChaveNova(null);
      carregar();
      toast({ titulo: "Agendamento ligado", descricao: `O AtendAI já fala com ${r.url}`, variante: "sucesso" });
    } catch (err) {
      toast({ titulo: "Não foi possível ligar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setLigando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Credenciais do AtendAI</CardTitle>
          <CardDescription>Como o ISPhub fala com a plataforma de atendimento deste provedor.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {config && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Chave atual:</span>
              <code className="text-xs">{config.chaveMascarada}</code>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="atendai-url">URL base</Label>
            <Input
              id="atendai-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://atendai.exemplo.com.br"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="atendai-chave">Chave de API do AtendAI</Label>
            <Input
              id="atendai-chave"
              type="password"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder={config ? "Informe a chave para atualizar" : "ak_..."}
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="brand" onClick={() => void salvar()} disabled={salvando || !baseUrl || !chave}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
            <Button variant="outline" onClick={() => void testar()} disabled={testando || !config}>
              {testando ? "Testando..." : "Testar conexão"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chave de agendamento</CardTitle>
          <CardDescription>
            Com ela o AtendAI consulta as vagas e marca a visita aqui. "Ligar agendamento" gera a chave e a entrega
            sozinho — ninguém precisa copiá-la.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!config ? (
            <p className="text-sm text-muted-foreground">Salve as credenciais acima antes de gerar a chave.</p>
          ) : (
            <>
              {config.chaveEntradaPrefixo ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Chave ativa:</span>
                  <code className="text-xs">{config.chaveEntradaPrefixo}…</code>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {config.chaveEntradaUsoEm
                      ? `usada em ${new Date(config.chaveEntradaUsoEm).toLocaleString("pt-BR")}`
                      : "nunca usada"}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma chave gerada — o AtendAI ainda não agenda aqui.</p>
              )}

              {/*
                A chave em claro aparece UMA vez e não é recuperável: o servidor
                guarda só o hash. Some da tela ao sair — avisar disso aqui é o
                que evita a ligação de amanhã pedindo "manda de novo".
              */}
              {chaveNova && (
                <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-3">
                  <p className="text-sm font-medium">Copie agora — esta chave não será mostrada de novo.</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-background px-2 py-1 text-xs">{chaveNova}</code>
                    <Button
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(chaveNova);
                        toast({ titulo: "Chave copiada", variante: "sucesso" });
                      }}
                    >
                      <Copy className="size-4" />
                      Copiar
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {/*
                  O caminho normal: a chave nasce e viaja sem ninguém ver. O
                  botão de gerar continua abaixo para quando o AtendAI está fora
                  do ar ou é outra instalação — aí não tem como entregar sozinho.
                */}
                <Button variant="brand" onClick={() => void ligar()} disabled={ligando}>
                  <Link2 className="size-4" />
                  {ligando ? "Ligando..." : config.chaveEntradaPrefixo ? "Religar (troca a chave)" : "Ligar agendamento"}
                </Button>
                <Button variant="outline" onClick={() => void gerar()} disabled={gerando}>
                  <KeyRound className="size-4" />
                  {gerando ? "Gerando..." : "Gerar chave para colar à mão"}
                </Button>
                {config.chaveEntradaPrefixo && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void atendaiConfigApi.revogarChaveEntrada(provedorId).then(() => {
                        setChaveNova(null);
                        carregar();
                        toast({ titulo: "Chave revogada", variante: "sucesso" });
                      })
                    }
                  >
                    Revogar
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
