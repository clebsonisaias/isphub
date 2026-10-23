import { rotuloDataHora } from "@isphub/shared";
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
import { atendaiConfigApi, categoriasApi, chaveParceiroApi, erpConfigApi, provedoresApi, syncApi, tecnicosSgpApi, tiposOsApi } from "@/lib/adminApi";
import type { AtendaiConfigPublic, ChaveParceiroPublic, FuncaoCampo, PapelSgp, TecnicoIsphubResumo, TecnicoSgpItem } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { ArrowLeft, CalendarDays, CheckCircle2, Copy, Download, KeyRound, Link2, RefreshCw, Sparkles, XCircle } from "lucide-react";

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
          <TabsTrigger value="tecnicos">Técnicos do SGP</TabsTrigger>
          <TabsTrigger value="atendentes">Atendentes do SGP</TabsTrigger>
          <TabsTrigger value="atendai">AtendAI</TabsTrigger>
          <TabsTrigger value="api-agenda">API de agendamento</TabsTrigger>
        </TabsList>
        <TabsContent value="sgp">
          <SgpConfigForm provedorId={id} />
        </TabsContent>
        <TabsContent value="tipos">
          <TiposOsManager provedorId={id} />
        </TabsContent>
        <TabsContent value="tecnicos">
          <TecnicosSgpManager provedorId={id} papel="tecnico" />
        </TabsContent>
        <TabsContent value="atendentes">
          <TecnicosSgpManager provedorId={id} papel="atendente" />
        </TabsContent>
        <TabsContent value="atendai">
          <AtendaiConfigForm provedorId={id} />
        </TabsContent>
        <TabsContent value="api-agenda">
          <ChaveParceiroCard provedorId={id} />
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
                última sync: {rotuloDataHora(config.ultimaSyncEm)}
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

/**
 * Tecnicos que o SGP do provedor conhece e a quem cada um corresponde no ISPhub.
 * O SGP mistura tecnico de campo com usuario de sistema e escreve nomes
 * diferentes da equipe; por isso cada linha pede uma decisao: vincular a um
 * tecnico existente, criar um novo (sem login) ou ignorar — e a funcao.
 */
const TEXTO_SGP = {
  tecnico: {
    titulo: "Técnicos do SGP",
    descricao:
      "Quem o SGP deste provedor conhece. Vincule cada um a um técnico do ISPhub (ou crie um novo, sem acesso ao app), " +
      "ignore quem não é técnico de campo e diga se é técnico ou auxiliar. Nome idêntico já vem vinculado; a lista se " +
      "atualiza sozinha todo dia. Técnico vinculado já recebe aqui as OS em que o SGP o pôs como responsável ou apoio.",
    coluna: "Técnico no ISPhub",
    criar: "+ Criar técnico novo",
    ignorar: "Não é técnico (ignorar)",
    vazio: "Nenhum técnico trazido do SGP ainda",
    contagem: "técnico(s) no SGP",
    colunaOs: "OS abertas",
    dicaOs: "OS abertas em que o SGP põe este login como responsável ou apoio",
    impacto: (n: number, os: number) =>
      `Vincular ${n === 1 ? "o pendente" : `os ${n} pendentes`} coloca ${os === 1 ? "1 OS aberta" : `${os} OS abertas`} no despacho daqui.`,
  },
  atendente: {
    titulo: "Atendentes do SGP",
    descricao:
      "Quem registrou OS neste SGP nos últimos 60 dias (o SGP só informa o login). Vincule cada login a uma atendente " +
      "do ISPhub (ou crie uma nova, sem acesso), e ignore quem não é atendente. A atendente vê só a fila deste provedor " +
      "e marca, remarca ou desmarca visitas; não despacha nem mexe em configuração.",
    coluna: "Atendente no ISPhub",
    criar: "+ Criar atendente nova",
    ignorar: "Não é atendente (ignorar)",
    vazio: "Nenhum login trazido do SGP ainda",
    contagem: "login(s) no SGP",
    colunaOs: "OS em 60 dias",
    dicaOs: "OS que este login registrou no SGP nos últimos 60 dias",
    impacto: (n: number, os: number) =>
      `${n === 1 ? "1 login sem decisão, que registrou" : `${n} logins sem decisão, que registraram`} ${os} OS nos últimos 60 dias.`,
  },
} as const;

function TecnicosSgpManager({ provedorId, papel }: { provedorId: string; papel: PapelSgp }) {
  const texto = TEXTO_SGP[papel];
  const { toast } = useToast();
  const [itens, setItens] = useState<TecnicoSgpItem[]>([]);
  const [tecnicos, setTecnicos] = useState<TecnicoIsphubResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await tecnicosSgpApi.listar(provedorId, papel);
      setItens(r.itens);
      setTecnicos(r.tecnicos);
    } catch (err) {
      toast({ titulo: `Erro ao carregar ${texto.titulo.toLowerCase()}`, descricao: mensagem(err), variante: "erro" });
    } finally {
      setCarregando(false);
    }
  }, [provedorId, papel, texto, toast]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function buscar() {
    setBuscando(true);
    try {
      const r = await tecnicosSgpApi.sincronizar(provedorId, papel);
      toast({
        titulo: `${r.total} ${texto.contagem}`,
        descricao: `${r.novos} novo(s) na lista, ${r.vinculadosAutomaticamente} vinculado(s) sozinho(s) pelo nome.`,
        variante: "sucesso",
      });
      await carregar();
    } catch (err) {
      toast({ titulo: "Erro ao buscar no SGP", descricao: mensagem(err), variante: "erro" });
    } finally {
      setBuscando(false);
    }
  }

  async function decidir(item: TecnicoSgpItem, d: Parameters<typeof tecnicosSgpApi.decidir>[2]) {
    setSalvando(item.id);
    try {
      await tecnicosSgpApi.decidir(provedorId, item.id, d);
      await carregar();
    } catch (err) {
      toast({ titulo: "Não foi possível salvar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setSalvando(null);
    }
  }

  function aoEscolherVinculo(item: TecnicoSgpItem, valor: string) {
    if (valor === "__criar") void decidir(item, papel === "tecnico" ? { criar: true, funcao: "tecnico" } : { criar: true });
    else if (valor === "__ignorar") void decidir(item, { ignorado: true });
    else void decidir(item, { usuarioId: valor || null, ...(item.ignorado ? { ignorado: false } : {}) });
  }

  const pendentes = itens.filter((i) => !i.usuario && !i.ignorado);
  const aDecidir = pendentes.length;
  const osPendentes = pendentes.reduce((t, i) => t + i.os, 0);
  // Pendentes primeiro, e o que mais pesa no topo; ignorados no fim.
  const ordem = (i: TecnicoSgpItem) => (i.ignorado ? 2 : i.usuario ? 1 : 0);
  const ordenados = [...itens].sort((a, b) => ordem(a) - ordem(b) || b.os - a.os);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>{texto.titulo}</CardTitle>
          <CardDescription>
            {texto.descricao}
          </CardDescription>
          {aDecidir ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-sm text-warning">
              {osPendentes > 0 ? texto.impacto(aDecidir, osPendentes) : `${aDecidir} aguardando decisão.`}
            </p>
          ) : null}
        </div>
        <Button variant="outline" onClick={() => void buscar()} disabled={buscando} className="shrink-0">
          <Download className={buscando ? "animate-pulse" : ""} />
          {buscando ? "Buscando..." : "Buscar do SGP"}
        </Button>
      </CardHeader>
      <CardContent>
        {carregando ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 rounded-md" />
            ))}
          </div>
        ) : itens.length === 0 ? (
          <EmptyState title={texto.vazio} description='Clique em "Buscar do SGP".' />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {papel === "tecnico" ? <TableHead>No SGP</TableHead> : null}
                <TableHead>Login</TableHead>
                <TableHead className="text-right" title={texto.dicaOs}>
                  {texto.colunaOs}
                </TableHead>
                <TableHead>{texto.coluna}</TableHead>
                {papel === "tecnico" ? <TableHead>Função</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenados.map((item) => {
                const valor = item.ignorado ? "__ignorar" : (item.usuario?.id ?? "");
                return (
                  <TableRow key={item.id} className={item.ignorado ? "opacity-60" : undefined}>
                    {papel === "tecnico" ? (
                      <TableCell>{item.nome ?? <span className="text-muted-foreground">(sem nome)</span>}</TableCell>
                    ) : null}
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.username ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.os > 0 ? item.os : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={valor}
                        disabled={salvando === item.id}
                        onChange={(e) => aoEscolherVinculo(item, e.target.value)}
                        aria-label={`${texto.coluna} para ${item.nome ?? item.username ?? item.sgpId}`}
                        className={valor ? "bg-secondary/40 px-2" : "border-warning/40 bg-warning/10 px-2 text-warning"}
                      >
                        <option value="">— decidir —</option>
                        <option value="__criar">{texto.criar}</option>
                        <option value="__ignorar">{texto.ignorar}</option>
                        {tecnicos.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nome}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    {papel === "tecnico" ? (
                    <TableCell>
                      <Select
                        value={item.usuario?.funcaoCampo ?? ""}
                        disabled={!item.usuario || salvando === item.id}
                        onChange={(e) => void decidir(item, { funcao: (e.target.value || null) as FuncaoCampo | null })}
                        aria-label={`Função de ${item.nome ?? item.username ?? item.sgpId}`}
                        className="px-2"
                      >
                        <option value="">—</option>
                        <option value="tecnico">Técnico</option>
                        <option value="auxiliar">Auxiliar</option>
                      </Select>
                    </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
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
  const [ligando, setLigando] = useState(false);

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

  async function ligar() {
    setLigando(true);
    try {
      const r = await atendaiConfigApi.ligarAgendamento(provedorId);
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
          <CardTitle>Agendamento pelo AtendAI</CardTitle>
          <CardDescription>
            "Ligar agendamento" gera a chave da API de agendamento e a entrega ao AtendAI sozinho — ninguém precisa
            copiá-la. A chave é a mesma da aba "API de agendamento"; religar troca a chave para todos os sistemas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!config ? (
            <p className="text-sm text-muted-foreground">Salve as credenciais acima antes de ligar o agendamento.</p>
          ) : (
            <>
              {config.chaveEntradaPrefixo ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Chave ativa:</span>
                  <code className="text-xs">{config.chaveEntradaPrefixo}…</code>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {config.chaveEntradaUsoEm
                      ? `usada em ${rotuloDataHora(config.chaveEntradaUsoEm)}`
                      : "nunca usada"}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma chave gerada — o AtendAI ainda não agenda aqui.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="brand" onClick={() => void ligar()} disabled={ligando}>
                  <Link2 className="size-4" />
                  {ligando ? "Ligando..." : config.chaveEntradaPrefixo ? "Religar (troca a chave)" : "Ligar agendamento"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * A chave da API de agendamento (`/api/parceiro/v1/agenda`) deste provedor.
 * Qualquer sistema do provedor entra com ela — o AtendAI é um deles, e a aba
 * dele tem o atalho que gera e entrega sozinho. Aqui é o caminho manual, pra
 * um ERP, um CRM ou um script do provedor.
 */
function ChaveParceiroCard({ provedorId }: { provedorId: string }) {
  const { toast } = useToast();
  const [chave, setChave] = useState<ChaveParceiroPublic | null | undefined>(undefined);
  const [rotulo, setRotulo] = useState("");
  const [gerando, setGerando] = useState(false);
  /* A chave em claro só existe nesta variável, até sair da tela. */
  const [chaveNova, setChaveNova] = useState<string | null>(null);

  const carregar = useCallback(() => {
    chaveParceiroApi
      .obter(provedorId)
      .then(setChave)
      .catch((err) => toast({ titulo: "Erro ao carregar", descricao: mensagem(err), variante: "erro" }));
  }, [provedorId, toast]);

  useEffect(carregar, [carregar]);

  async function gerar() {
    setGerando(true);
    try {
      const { chave: nova } = await chaveParceiroApi.gerar(provedorId, rotulo.trim() || undefined);
      setChaveNova(nova);
      carregar();
    } catch (err) {
      toast({ titulo: "Não foi possível gerar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setGerando(false);
    }
  }

  async function revogar() {
    try {
      await chaveParceiroApi.revogar(provedorId);
      setChaveNova(null);
      carregar();
      toast({ titulo: "Chave revogada", descricao: "Nenhum sistema externo agenda mais por aqui.", variante: "sucesso" });
    } catch (err) {
      toast({ titulo: "Não foi possível revogar", descricao: mensagem(err), variante: "erro" });
    }
  }

  const base = `${window.location.origin.replace("painel.", "api.")}/api/parceiro/v1/agenda`;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            API de agendamento
          </CardTitle>
          <CardDescription>
            Um sistema do provedor (ERP, CRM, bot) consulta as vagas e marca a visita aqui, com uma chave{" "}
            <code className="text-xs">isk_…</code> no cabeçalho <code className="text-xs">Authorization: Bearer</code>.
            A mesma regra da agenda vale para ele: 15 por turno, sábado só de manhã, feriado não oferece.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {chave === undefined ? (
            <Skeleton className="h-10 w-full" />
          ) : chave ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Chave ativa:</span>
              <code className="text-xs">{chave.prefixo}…</code>
              {chave.rotulo && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{chave.rotulo}</span>}
              <span className="ml-auto text-xs text-muted-foreground">
                {chave.usoEm ? `usada em ${rotuloDataHora(chave.usoEm)}` : "nunca usada"}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma chave gerada — nenhum sistema externo agenda aqui ainda.</p>
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

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="chave-rotulo">Sistema que vai usar (opcional)</Label>
              <Input
                id="chave-rotulo"
                value={rotulo}
                onChange={(e) => setRotulo(e.target.value)}
                placeholder={chave?.rotulo ?? "ex.: ERP, CRM, AtendAI"}
                maxLength={60}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="brand" onClick={() => void gerar()} disabled={gerando}>
                <KeyRound className="size-4" />
                {gerando ? "Gerando..." : chave ? "Regerar (troca a chave)" : "Gerar chave"}
              </Button>
              {chave && (
                <Button variant="outline" onClick={() => void revogar()}>
                  Revogar
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como usar</CardTitle>
          <CardDescription>
            Documentação completa em <code className="text-xs">docs/api-agendamento.md</code> do repositório e no OpenAPI
            (tag "API de agendamento").
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
{`# próximas vagas (só o que cabe)
curl -H "Authorization: Bearer isk_..." "${base}/vagas?regiao=Macaíba&quantas=6"

# marcar a visita da OS 12345 do SGP
curl -X POST -H "Authorization: Bearer isk_..." -H "Content-Type: application/json" \\
  -d '{"sgpOsId":"12345","dia":"2026-10-10","turno":"manha","regiao":"Macaíba","marcadoPor":"Maria"}' \\
  ${base}/marcar
# 201 marcou · 409 não coube (a mensagem diz por quê: lotado, sábado só manhã, feriado…)`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
