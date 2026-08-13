import { useCallback, useEffect, useState } from "react";
import type { LinhaCandidata, UsuarioPublic } from "@isphub/shared";
import { cpfValido } from "@isphub/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { linhaMovelApi } from "@/lib/linhaMovelApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { AlertTriangle, Link2, Search, Smartphone, Unlink } from "lucide-react";

/**
 * Vincular a linha móvel corporativa de um usuário.
 *
 * ## Por que o CPF é digitado aqui e não guardado
 *
 * O CPF é a **única porta** para descobrir a linha na operadora — não existe
 * busca por número. Mas ele não é necessário para *consultá-la* depois: o
 * `lineId` basta. Então o admin digita o CPF uma vez, aqui, e o que fica gravado
 * é só o ponteiro. O CPF não chega ao banco.
 *
 * ## Por que a tela mostra tão pouco
 *
 * O token da operadora vale para a base **inteira** da CITmax. Este é o único
 * ponto do sistema onde um CPF qualquer produz resposta — então ela devolve
 * número mascarado e status, e mais nada. O nome do titular é comparado com o do
 * cadastro no servidor e **nunca exibido**: mostrá-lo transformaria esta tela num
 * jeito de descobrir de quem é um CPF.
 */
export function VincularLinhaDialog({
  usuario,
  onFechar,
}: {
  usuario: UsuarioPublic | null;
  onFechar: () => void;
}) {
  const { toast } = useToast();
  const [cpf, setCpf] = useState("");
  const [vinculado, setVinculado] = useState<boolean | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{
    linhas: LinhaCandidata[];
    nomeConfere: boolean;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!usuario) return;
    setVinculado(null);
    try {
      setVinculado((await linhaMovelApi.vinculo(usuario.id)).vinculado);
    } catch {
      setVinculado(false);
    }
  }, [usuario]);

  useEffect(() => {
    if (usuario) {
      setCpf("");
      setResultado(null);
      setErro(null);
      void carregar();
    }
  }, [usuario, carregar]);

  const digitos = cpf.replace(/\D/g, "");

  async function buscar() {
    if (!usuario) return;
    setBuscando(true);
    setErro(null);
    setResultado(null);
    try {
      setResultado(await linhaMovelApi.buscar(usuario.id, digitos));
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Falha ao consultar a operadora.");
    } finally {
      setBuscando(false);
    }
  }

  async function vincular(lineId: string) {
    if (!usuario) return;
    setSalvando(true);
    try {
      await linhaMovelApi.vincular(usuario.id, lineId);
      toast({
        titulo: "Linha vinculada",
        descricao: `${usuario.nome} já vê a linha no app, em Perfil.`,
        variante: "sucesso",
      });
      onFechar();
    } catch (e) {
      toast({
        titulo: "Não deu para vincular",
        descricao: e instanceof ApiError ? e.message : "Tente de novo em instantes.",
        variante: "erro",
      });
    } finally {
      setSalvando(false);
    }
  }

  async function desvincular() {
    if (!usuario) return;
    setSalvando(true);
    try {
      await linhaMovelApi.desvincular(usuario.id);
      toast({ titulo: "Vínculo removido", variante: "sucesso" });
      onFechar();
    } catch (e) {
      toast({
        titulo: "Não deu para remover",
        descricao: e instanceof ApiError ? e.message : "Tente de novo.",
        variante: "erro",
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!usuario} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-4 text-primary" aria-hidden />
            Linha móvel de {usuario?.nome}
          </DialogTitle>
          <DialogDescription>
            Informe o CPF do funcionário para localizar o chip corporativo dele. O CPF é usado só
            para a busca — o que fica guardado é a linha escolhida.
          </DialogDescription>
        </DialogHeader>

        {vinculado === null ? (
          <Skeleton className="h-10" />
        ) : vinculado ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <span className="flex items-center gap-2">
              <Link2 className="size-4 text-success" aria-hidden />
              Já existe uma linha vinculada.
            </span>
            <Button variant="ghost" size="sm" onClick={() => void desvincular()} disabled={salvando}>
              <Unlink className="size-4" aria-hidden />
              Remover
            </Button>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="vinc-cpf">CPF do funcionário</Label>
          <div className="flex gap-2">
            <Input
              id="vinc-cpf"
              value={cpf}
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
              onChange={(e) => setCpf(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && cpfValido(digitos) && void buscar()}
            />
            <Button onClick={() => void buscar()} disabled={buscando || !cpfValido(digitos)}>
              <Search className="size-4" aria-hidden />
              {buscando ? "Buscando…" : "Buscar"}
            </Button>
          </div>
          {digitos.length >= 11 && !cpfValido(digitos) && (
            <p className="text-xs text-destructive">
              CPF inválido — confira os dígitos antes de consultar a operadora.
            </p>
          )}
        </div>

        {erro && (
          <p role="status" className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {erro}
          </p>
        )}

        {resultado && (
          <div className="space-y-2">
            {!resultado.nomeConfere && (
              /*
               * A defesa contra o dígito trocado. Sem ela, um CPF errado produz
               * uma tela que FUNCIONA — com a linha de um estranho — e ninguém
               * desconfia. O nome encontrado não aparece de propósito.
               */
              <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  O titular deste CPF na operadora <strong>não confere</strong> com o nome do
                  cadastro. Confira o CPF antes de vincular.
                </span>
              </p>
            )}

            {resultado.linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma linha encontrada para este CPF na operadora.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {resultado.linhas.map((l) => (
                  <li key={l.lineId} className="flex items-center justify-between gap-3 p-3">
                    <div>
                      <p className="font-mono text-sm">{l.numeroMascarado ?? "número indisponível"}</p>
                      <p className="text-xs text-muted-foreground">{l.statusRotulo}</p>
                    </div>
                    <Button size="sm" onClick={() => void vincular(l.lineId)} disabled={salvando}>
                      Vincular
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
