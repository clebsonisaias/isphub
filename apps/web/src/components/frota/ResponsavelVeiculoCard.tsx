import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TecnicoComViaturaFixa, ViaturaFixaPublic } from "@isphub/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/apiClient";
import { Loader2, UserRound } from "lucide-react";

/**
 * "O carro X e do tecnico Y" — quem decide e o gestor.
 *
 * O carro fixo e o PADRAO do tecnico: sem escala no dia, e nele que o turno
 * abre. A escala do dia continua sendo a excecao (carro na oficina, troca de
 * um dia so).
 */

interface ViaturaFixaDoVeiculo {
  vigentes: ViaturaFixaPublic[];
  historico: ViaturaFixaPublic[];
}

interface ResultadoDefinir {
  viatura: ViaturaFixaPublic | null;
  aplicadoAgora: boolean;
  motivoNaoAplicado: "sem_jornada" | "escala_hoje" | null;
}

const PAPEL_ROTULO = { motorista: "motorista", passageiro: "ajudante" } as const;

function data(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** O que dizer ao gestor depois de salvar — quando a troca passa a valer. */
function quandoVale(r: ResultadoDefinir): string {
  if (r.aplicadoAgora) return "O técnico está em turno: a troca já vale agora.";
  if (r.motivoNaoAplicado === "escala_hoje") return "Hoje vale a escala do dia; o carro fixo vale a partir de amanhã.";
  return "Vale a partir do próximo turno do técnico.";
}

export function ResponsavelVeiculoCard({ veiculoId, rotulo }: { veiculoId: string; rotulo: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tecnicoId, setTecnicoId] = useState("");
  const [papel, setPapel] = useState<"motorista" | "passageiro">("motorista");
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState<ViaturaFixaPublic | null>(null);

  const doVeiculo = useQuery({
    queryKey: ["frota", "viatura-fixa", veiculoId],
    queryFn: () => api.get<ViaturaFixaDoVeiculo>(`/frota/veiculos/${veiculoId}/viatura-fixa`),
  });
  const quadro = useQuery({
    queryKey: ["frota", "viaturas-fixas"],
    queryFn: () => api.get<TecnicoComViaturaFixa[]>("/frota/viaturas-fixas"),
  });

  const escolhido = quadro.data?.find((t) => t.usuarioId === tecnicoId) ?? null;
  // Aviso de troca: o tecnico escolhido ja tem OUTRO carro fixo.
  const tiraDeOutroCarro = escolhido?.viatura && escolhido.viatura.veiculoId !== veiculoId ? escolhido.viatura : null;

  async function definir(usuarioId: string, novoVeiculo: string | null, novoPapel = papel) {
    setSalvando(true);
    try {
      const r = await api.put<ResultadoDefinir>(`/frota/tecnicos/${usuarioId}/viatura-fixa`, {
        veiculoId: novoVeiculo,
        papel: novoPapel,
      });
      toast({
        variante: "sucesso",
        titulo: novoVeiculo ? `Carro fixo definido: ${rotulo}` : `Técnico tirado do ${rotulo}`,
        descricao: quandoVale(r),
      });
      setTecnicoId("");
      await queryClient.invalidateQueries({ queryKey: ["frota"] });
    } catch (e) {
      toast({
        variante: "erro",
        titulo: "Não foi possível salvar o técnico do carro",
        descricao: e instanceof ApiError ? e.message : "Falha ao comunicar com o servidor",
      });
    } finally {
      setSalvando(false);
    }
  }

  const vigentes = doVeiculo.data?.vigentes ?? [];
  const passados = (doVeiculo.data?.historico ?? []).filter((h) => h.fimEm).slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="size-4 text-primary" aria-hidden />
          Técnico responsável
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {doVeiculo.isError ? (
          <ErrorState message="Não foi possível carregar o técnico do carro." onRetry={() => void doVeiculo.refetch()} />
        ) : doVeiculo.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : vigentes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum técnico fixo neste carro. Sem técnico fixo, ele só sai quando alguém é escalado nele.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {vigentes.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm">
                <div>
                  <p className="font-medium">
                    {v.usuarioNome} <span className="font-normal text-muted-foreground">· {PAPEL_ROTULO[v.papel]}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Desde {data(v.inicioEm)}
                    {v.definidoPorNome ? ` · definido por ${v.definidoPorNome}` : ""}
                  </p>
                </div>
                <Button variant="outline" size="sm" disabled={salvando} onClick={() => setRemovendo(v)}>
                  Tirar {v.usuarioNome.split(" ")[0]}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="tecnico-fixo">Colocar técnico neste carro</Label>
            {quadro.isError ? (
              <p className="text-sm text-destructive">Não foi possível carregar os técnicos.</p>
            ) : (
              <Select
                id="tecnico-fixo"
                value={tecnicoId}
                disabled={quadro.isPending || salvando}
                onChange={(e) => setTecnicoId(e.target.value)}
              >
                <option value="">{quadro.isPending ? "Carregando técnicos…" : "Escolha o técnico"}</option>
                {(quadro.data ?? [])
                  .filter((t) => !vigentes.some((v) => v.usuarioId === t.usuarioId))
                  .map((t) => (
                    <option key={t.usuarioId} value={t.usuarioId}>
                      {t.nome}
                      {t.viatura ? ` (hoje no ${t.viatura.veiculoApelido ?? t.viatura.veiculoPlaca})` : " (sem carro)"}
                    </option>
                  ))}
              </Select>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="papel-fixo">Vai como</Label>
            <Select
              id="papel-fixo"
              value={papel}
              disabled={salvando}
              onChange={(e) => setPapel(e.target.value as "motorista" | "passageiro")}
            >
              <option value="motorista">Motorista</option>
              <option value="passageiro">Ajudante</option>
            </Select>
          </div>
          <Button disabled={!tecnicoId || salvando} onClick={() => void definir(tecnicoId, veiculoId)}>
            {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Colocar no {rotulo}
          </Button>
        </div>
        {tiraDeOutroCarro ? (
          <p className="text-xs text-warning" role="status">
            {escolhido!.nome} sai do {tiraDeOutroCarro.veiculoApelido ?? tiraDeOutroCarro.veiculoPlaca}, que fica sem esse
            técnico.
          </p>
        ) : null}

        {passados.length > 0 ? (
          <div className="border-t border-border pt-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Quem já teve este carro</p>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground tabular-nums">
              {passados.map((h) => (
                <li key={h.id}>
                  {h.usuarioNome}: {data(h.inicioEm)} → {data(h.fimEm!)}
                  {h.encerradoPorNome ? ` · trocado por ${h.encerradoPorNome}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={!!removendo} onOpenChange={(v) => !salvando && !v && setRemovendo(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Tirar {removendo?.usuarioNome} do {rotulo}?
            </DialogTitle>
            <DialogDescription className="pt-2 text-left">
              {removendo?.usuarioNome} fica sem carro fixo. Se estiver em turno agora, sai do carro na hora. O histórico
              fica guardado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={salvando} onClick={() => setRemovendo(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={salvando}
              onClick={async () => {
                if (!removendo) return;
                await definir(removendo.usuarioId, null, removendo.papel);
                setRemovendo(null);
              }}
            >
              {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Tirar {removendo?.usuarioNome.split(" ")[0]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
