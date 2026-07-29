import { useEffect, useState } from "react";
import type { CanalWhatsappConfigPublic } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AdminNav } from "@/components/admin/AdminNav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { canaisWhatsappApi } from "@/lib/canaisWhatsappApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { CheckCircle2, XCircle } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

function ConfigStatus({ config }: { config: CanalWhatsappConfigPublic | undefined }) {
  if (!config?.configurado) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
      {Object.entries(config.campos).map(([chave, valor]) => (
        <span key={chave} className="text-muted-foreground">
          {chave}: <code className="text-xs text-foreground">{valor}</code>
        </span>
      ))}
      {config.ultimaVerificacaoEm && (
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          {config.ultimaVerificacaoOk ? (
            <CheckCircle2 className="size-3.5 text-success" />
          ) : (
            <XCircle className="size-3.5 text-destructive" />
          )}
          {config.ultimaVerificacaoMensagem ?? "verificado"}
        </span>
      )}
    </div>
  );
}

function MetaConfigForm({ config, onSalvo }: { config: CanalWhatsappConfigPublic | undefined; onSalvo: () => void }) {
  const { toast } = useToast();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);

  async function handleSalvar() {
    setSalvando(true);
    try {
      await canaisWhatsappApi.salvar("meta", { tipo: "meta", phoneNumberId, accessToken, verifyToken, appSecret });
      setAccessToken("");
      setAppSecret("");
      toast({ titulo: "Meta WhatsApp Cloud API salvo", variante: "sucesso" });
      onSalvo();
    } catch (err) {
      toast({ titulo: "Erro ao salvar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setSalvando(false);
    }
  }

  async function handleTestar() {
    setTestando(true);
    try {
      const r = await canaisWhatsappApi.testar("meta");
      toast({ titulo: r.ok ? "Conexão OK" : "Falha na conexão", descricao: r.message, variante: r.ok ? "sucesso" : "erro" });
      onSalvo();
    } catch (err) {
      toast({ titulo: "Erro ao testar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setTestando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meta WhatsApp Cloud API</CardTitle>
        <CardDescription>Integração oficial. Segredos são cifrados e nunca reexibidos — informe novamente para trocar.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ConfigStatus config={config} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="phoneNumberId">Phone Number ID</Label>
            <Input id="phoneNumberId" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="accessToken">Access Token</Label>
            <Input
              id="accessToken"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={config?.configurado ? "Informe para atualizar" : "Token permanente do app Meta"}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="verifyToken">Verify Token (webhook)</Label>
            <Input
              id="verifyToken"
              type="password"
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              placeholder={config?.configurado ? "Informe para atualizar" : "Definido por você, ecoado pela Meta"}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="appSecret">App Secret</Label>
            <Input
              id="appSecret"
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={config?.configurado ? "Informe para atualizar" : "Assina os webhooks (X-Hub-Signature-256)"}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="brand" onClick={handleSalvar} disabled={salvando || !phoneNumberId || !accessToken || !verifyToken || !appSecret}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant="outline" onClick={handleTestar} disabled={testando || !config?.configurado}>
            {testando ? "Testando..." : "Testar conexão"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EvolutionConfigForm({ config, onSalvo }: { config: CanalWhatsappConfigPublic | undefined; onSalvo: () => void }) {
  const { toast } = useToast();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);

  async function handleSalvar() {
    setSalvando(true);
    try {
      await canaisWhatsappApi.salvar("evolution", { tipo: "evolution", baseUrl, apiKey, instanceName });
      setApiKey("");
      toast({ titulo: "Evolution API salvo", variante: "sucesso" });
      onSalvo();
    } catch (err) {
      toast({ titulo: "Erro ao salvar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setSalvando(false);
    }
  }

  async function handleTestar() {
    setTestando(true);
    try {
      const r = await canaisWhatsappApi.testar("evolution");
      toast({ titulo: r.ok ? "Instância conectada" : "Instância não conectada", descricao: r.message, variante: r.ok ? "sucesso" : "erro" });
      onSalvo();
    } catch (err) {
      toast({ titulo: "Erro ao testar", descricao: mensagem(err), variante: "erro" });
    } finally {
      setTestando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evolution API</CardTitle>
        <CardDescription>Instância self-hosted compartilhada por todo o ISPhub (não é por provedor).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ConfigStatus config={config} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="baseUrl">URL base da instância</Label>
            <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://evolution.exemplo.com.br" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="instanceName">Nome da instância</Label>
            <Input id="instanceName" value={instanceName} onChange={(e) => setInstanceName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.configurado ? "Informe para atualizar" : "Chave da instância"}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="brand" onClick={handleSalvar} disabled={salvando || !baseUrl || !apiKey || !instanceName}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant="outline" onClick={handleTestar} disabled={testando || !config?.configurado}>
            {testando ? "Testando..." : "Testar conexão"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CanaisWhatsappPage() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<CanalWhatsappConfigPublic[]>([]);

  async function carregar() {
    try {
      setConfigs(await canaisWhatsappApi.listar());
    } catch (err) {
      toast({ titulo: "Erro ao carregar canais", descricao: mensagem(err), variante: "erro" });
    }
  }
  useEffect(() => {
    void carregar();
  }, []);

  const metaConfig = configs.find((c) => c.tipo === "meta");
  const evolutionConfig = configs.find((c) => c.tipo === "evolution");

  return (
    <AppShell>
      <AnimatedPage>
        <AdminNav />
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Canais WhatsApp</h1>
          <p className="text-sm text-muted-foreground">Integrações de chat com clientes — habilite o módulo "Conversas com clientes" depois de configurar.</p>
        </div>
        <div className="flex flex-col gap-6 max-w-2xl">
          <MetaConfigForm config={metaConfig} onSalvo={carregar} />
          <EvolutionConfigForm config={evolutionConfig} onSalvo={carregar} />
        </div>
      </AnimatedPage>
    </AppShell>
  );
}
