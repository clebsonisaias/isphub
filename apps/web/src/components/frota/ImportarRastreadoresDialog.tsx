import { useCallback, useEffect, useState } from "react";
import { formatarPlaca, normalizarPlaca, placaValida } from "@isphub/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
// `frotaMapaApi`, e nao `veiculosApi`: rastreador e mapa moram naquele objeto.
import { frotaMapaApi, type RastreadorDisponivel } from "@/lib/veiculosApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { Download, Link2 } from "lucide-react";

/**
 * Importar aparelhos da conta do fornecedor.
 *
 * A chave de API da PlataformaTK e vinculada a UMA conta — a documentacao deles
 * diz isso com todas as letras. Trocar a chave troca a frota inteira que o
 * ISPhub enxerga, e sem esta tela o gestor precisaria abrir o portal do
 * fornecedor e copiar identificador por identificador.
 *
 * **A placa e sempre CONFIRMADA, nunca aceita.** O servidor sugere lendo o
 * apelido do aparelho (`"C011 - RGI4H16"`), mas quem batizou aquilo nao seguiu
 * contrato nenhum. Uma placa errada aqui nao produz um cadastro feio: produz um
 * rastreador vinculado ao carro de outra pessoa, e dali em diante o mapa, as
 * viagens e o custo por quilometro ficam todos no veiculo errado. Por isso o
 * campo vem preenchido e editavel, e nada entra sem alguem ter olhado.
 */
export function ImportarRastreadoresDialog({
  aberto,
  aoFechar,
  aoImportar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoImportar: () => void;
}) {
  const { toast } = useToast();
  const [lista, setLista] = useState<RastreadorDisponivel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [placas, setPlacas] = useState<Record<string, string>>({});
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    setLista(null);
    try {
      const r = await frotaMapaApi.disponiveis();
      setLista(r);
      // Pre-marca so quem tem placa reconhecida: o resto exige digitar antes.
      setPlacas(Object.fromEntries(r.map((x) => [x.identificadorExterno, x.placaSugerida ?? ""])));
      setMarcados(Object.fromEntries(r.map((x) => [x.identificadorExterno, x.placaSugerida !== null])));
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não deu para falar com o fornecedor.");
    }
  }, []);

  useEffect(() => {
    if (aberto) void carregar();
  }, [aberto, carregar]);

  const escolhidos = (lista ?? []).filter((x) => marcados[x.identificadorExterno]);
  const invalidas = escolhidos.filter((x) => !placaValida(normalizarPlaca(placas[x.identificadorExterno] ?? "")));

  async function importar() {
    setEnviando(true);
    try {
      const feitos = await frotaMapaApi.importar(
        escolhidos.map((x) => ({
          identificadorExterno: x.identificadorExterno,
          placa: placas[x.identificadorExterno]!,
          modelo: x.modelo,
        })),
      );
      const novos = feitos.filter((f) => f.veiculoCriado).length;
      toast({
        titulo: `${feitos.length} rastreador(es) importado(s)`,
        descricao:
          novos > 0
            ? `${novos} veículo(s) criado(s). Complete marca, modelo e ano no cadastro.`
            : "Todos foram vinculados a veículos que já existiam.",
        variante: "sucesso",
      });
      aoImportar();
      aoFechar();
    } catch (e) {
      toast({
        titulo: "A importação falhou",
        descricao: e instanceof ApiError ? e.message : "Tente de novo em instantes.",
        variante: "erro",
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar da PlataformaTK</DialogTitle>
          <DialogDescription>
            Aparelhos que existem na conta do fornecedor e ainda não estão no ISPhub. Confira a placa
            de cada um — ela é um palpite lido do apelido do aparelho.
          </DialogDescription>
        </DialogHeader>

        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}

        {!lista && !erro && <Skeleton className="h-40" />}

        {lista?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum aparelho novo — tudo o que está na conta do fornecedor já foi cadastrado aqui.
          </p>
        )}

        {lista && lista.length > 0 && (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {lista.map((r) => {
              const placa = placas[r.identificadorExterno] ?? "";
              const ok = placaValida(normalizarPlaca(placa));
              const marcado = marcados[r.identificadorExterno] ?? false;
              return (
                <li
                  key={r.identificadorExterno}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={marcado}
                    aria-label={`Importar ${r.nome ?? r.identificadorExterno}`}
                    onChange={(e) =>
                      setMarcados((m) => ({ ...m, [r.identificadorExterno]: e.target.checked }))
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.nome ?? "(sem apelido)"}</p>
                    <p className="text-xs text-muted-foreground">
                      id {r.identificadorExterno}
                      {r.modelo && ` · ${r.modelo}`}
                      {r.intervaloSegundos && ` · a cada ${r.intervaloSegundos}s`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/*
                      O veiculo JA existir muda a acao de "criar" pra "vincular",
                      e o gestor precisa saber disso antes de confirmar — senao
                      ele acha que vai duplicar o carro.
                    */}
                    {r.veiculoExistenteId && (
                      <span
                        className="flex items-center gap-1 text-[11px] text-muted-foreground"
                        title="Este veículo já está cadastrado — será apenas vinculado"
                      >
                        <Link2 className="size-3" aria-hidden />
                        já existe
                      </span>
                    )}
                    <Input
                      value={placa}
                      aria-label={`Placa de ${r.nome ?? r.identificadorExterno}`}
                      placeholder="Placa"
                      className={`w-32 ${marcado && !ok ? "border-destructive" : ""}`}
                      onChange={(e) =>
                        setPlacas((p) => ({ ...p, [r.identificadorExterno]: e.target.value }))
                      }
                    />
                  </div>
                  {marcado && !ok && (
                    <p className="w-full text-xs text-destructive">
                      {placa.trim()
                        ? `"${placa}" não é uma placa válida.`
                        : "Sem placa no apelido do aparelho — digite a do carro."}
                    </p>
                  )}
                  {marcado && ok && placa !== formatarPlaca(normalizarPlaca(placa)) && (
                    <p className="w-full text-xs text-muted-foreground">
                      Será gravada como {formatarPlaca(normalizarPlaca(placa))}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            onClick={() => void importar()}
            disabled={enviando || escolhidos.length === 0 || invalidas.length > 0}
          >
            <Download className="size-4" aria-hidden />
            {enviando
              ? "Importando…"
              : `Importar ${escolhidos.length > 0 ? `(${escolhidos.length})` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
