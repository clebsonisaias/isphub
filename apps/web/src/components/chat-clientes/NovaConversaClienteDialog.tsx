import { useEffect, useMemo, useState } from "react";
import { CanalWhatsapp, type ConversaClienteResumo, type TemplateWhatsappDTO } from "@isphub/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/apiClient";
import { clientesChatApi } from "@/lib/clientesChatApi";
import { useToast } from "@/context/ToastContext";
import { Loader2 } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/**
 * Troca `{{n}}` pelo que o atendente digitou. Variável ainda vazia continua
 * aparecendo como `{{n}}` — o preview tem que mostrar o buraco, não escondê-lo.
 */
function renderizar(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{\{(\d+)\}\}/g, (original, indice: string) => vars[indice]?.trim() || original);
}

/** Só dígitos: a Meta recusa número com máscara, e o servidor normaliza depois. */
function digitos(bruto: string): string {
  return bruto.replace(/\D/g, "");
}

/**
 * Primeiro contato com um cliente só sai por template HSM aprovado — fora da
 * janela de 24h a Meta recusa texto livre. Por isso o canal aqui é fixo em Meta:
 * a Evolution não tem template.
 */
export function NovaConversaClienteDialog({
  open,
  onOpenChange,
  onConversaCriada,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConversaCriada: (conversa: ConversaClienteResumo) => void;
}) {
  const { toast } = useToast();
  const [telefone, setTelefone] = useState("");
  const [nomeContato, setNomeContato] = useState("");
  const [templates, setTemplates] = useState<TemplateWhatsappDTO[] | null>(null);
  const [erroTemplates, setErroTemplates] = useState<string | null>(null);
  const [templateNome, setTemplateNome] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTelefone("");
    setNomeContato("");
    setTemplateNome("");
    setVars({});
    setTemplates(null);
    setErroTemplates(null);
    let vivo = true;
    clientesChatApi
      .templates()
      .then((lista) => {
        if (!vivo) return;
        setTemplates(lista);
        // Um único template aprovado é o caso comum — poupa um clique.
        if (lista.length === 1) setTemplateNome(lista[0].nome);
      })
      .catch((err) => {
        if (!vivo) return;
        setTemplates([]);
        setErroTemplates(mensagem(err));
      });
    return () => {
      vivo = false;
    };
  }, [open]);

  const template = useMemo(() => (templates ?? []).find((t) => t.nome === templateNome) ?? null, [templates, templateNome]);

  const telefoneValido = digitos(telefone).length >= 10;
  const varsCompletas = (template?.variaveis ?? []).every((i) => (vars[String(i)] ?? "").trim().length > 0);
  const podeEnviar = telefoneValido && !!template && varsCompletas && !enviando;

  async function handleEnviar() {
    if (!template || !podeEnviar) return;
    setEnviando(true);
    try {
      const conversa = await clientesChatApi.iniciar({
        telefone: digitos(telefone),
        nomeContato: nomeContato.trim() || undefined,
        canal: CanalWhatsapp.META,
        templateNome: template.nome,
        // Só o que o template pede — variável de template antigo que sobrou no state nunca vai junto.
        vars: Object.fromEntries(template.variaveis.map((i) => [String(i), (vars[String(i)] ?? "").trim()])),
      });
      onConversaCriada(conversa);
      onOpenChange(false);
    } catch (err) {
      toast({ titulo: "Não foi possível iniciar a conversa", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>
            O primeiro contato sai pelo WhatsApp Oficial e só por template aprovado pela Meta. O cliente responde e a conversa cai aqui.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="telefone">Telefone</Label>
              <Input
                id="telefone"
                inputMode="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(11) 91234-5678"
              />
              {telefone.trim() !== "" && !telefoneValido && <p className="text-xs text-destructive">Informe DDD + número.</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="nomeContato">Nome do contato (opcional)</Label>
              <Input id="nomeContato" value={nomeContato} onChange={(e) => setNomeContato(e.target.value)} placeholder="Como aparece na lista" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="template">Template</Label>
            {templates === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Carregando templates…
              </p>
            ) : erroTemplates ? (
              <p className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-foreground">{erroTemplates}</p>
            ) : templates.length === 0 ? (
              <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground">
                Nenhum template aprovado nesta conta WhatsApp Business. Crie e aprove um template no Business Manager da Meta.
              </p>
            ) : (
              <Select
                id="template"
                value={templateNome}
                onChange={(e) => {
                  setTemplateNome(e.target.value);
                  setVars({});
                }}
                className="bg-secondary/40"
              >
                <option value="">Escolha um template…</option>
                {templates.map((t) => (
                  <option key={`${t.nome}:${t.idioma}`} value={t.nome}>
                    {t.nome} ({t.idioma}) — {t.categoria}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {template && template.variaveis.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {template.variaveis.map((indice) => (
                <div key={indice} className="flex flex-col gap-2">
                  <Label htmlFor={`var-${indice}`}>{`Variável {{${indice}}}`}</Label>
                  <Input
                    id={`var-${indice}`}
                    value={vars[String(indice)] ?? ""}
                    onChange={(e) => setVars((prev) => ({ ...prev, [String(indice)]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}

          {template && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Prévia da mensagem</span>
              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
                {template.header && <p className="mb-1 whitespace-pre-wrap break-words font-semibold">{renderizar(template.header, vars)}</p>}
                <p className="whitespace-pre-wrap break-words">{renderizar(template.corpo, vars)}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="brand" onClick={handleEnviar} disabled={!podeEnviar}>
            {enviando ? "Enviando..." : "Enviar template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
