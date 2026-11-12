import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  COMBUSTIVEL_ROTULO,
  EVENTO_RASTREADOR_ROTULO,
  diaBrasileiroIso,
  type ItemLinhaVeiculo,
  type LinhaDoVeiculo,
} from "@isphub/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Fuel,
  History,
  KeyRound,
  Loader2,
  ShieldCheck,
  Undo2,
  UserRound,
  Wrench,
} from "lucide-react";

/**
 * A LINHA DO TEMPO do carro: tudo em ordem, dia a dia — quem pegou e devolveu,
 * checklists com a foto do painel, abastecimentos, manutencoes e alarmes.
 */

type Filtro = "uso" | "checklist" | "abastecimento" | "manutencao" | "alarme";

const FILTROS: { id: Filtro; rotulo: string; tipos: ItemLinhaVeiculo["tipo"][] }[] = [
  { id: "uso", rotulo: "Quem pegou", tipos: ["retirada", "devolucao", "carro_fixo"] },
  { id: "checklist", rotulo: "Checklists", tipos: ["checklist"] },
  { id: "abastecimento", rotulo: "Abastecimentos", tipos: ["abastecimento"] },
  { id: "manutencao", rotulo: "Manutenções", tipos: ["manutencao"] },
  { id: "alarme", rotulo: "Alarmes", tipos: ["alarme"] },
];

const JANELAS = [7, 30] as const;

function somarDias(dia: string, n: number) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function rotuloDia(dia: string, hoje: string) {
  if (dia === hoje) return "Hoje";
  if (dia === somarDias(hoje, -1)) return "Ontem";
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

function dataCurta(dia: string) {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const km = (n: number | null) => (n != null ? `${n.toLocaleString("pt-BR")} km` : null);
const real = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const juntar = (...partes: (string | null | false | undefined)[]) => partes.filter(Boolean).join(" · ");

const ORIGEM: Record<string, (por: string) => string> = {
  ajuste: (por) => `colocado pelo gestor (${por})`,
  jornada: () => "ao abrir o turno",
  declaracao: (por) => `declarado por ${por}`,
};
const MOTIVO: Record<string, string> = {
  jornada: "fim do turno",
  troca_veiculo: "trocou de carro",
  ajuste: "retirado pelo gestor",
};
const PAPEL = { motorista: "motorista", passageiro: "ajudante" } as const;

interface Visual {
  icone: ReactNode;
  titulo: string;
  detalhe: string;
  tom?: "alerta" | "ok";
}

function visual(i: ItemLinhaVeiculo): Visual {
  const ic = "size-4";
  switch (i.tipo) {
    case "retirada":
      return {
        icone: <KeyRound className={ic} />,
        titulo: `${i.usuarioNome} pegou o carro`,
        detalhe: juntar(PAPEL[i.papel], ORIGEM[i.origem]?.(i.declaradoPorNome), km(i.odometroKm)),
      };
    case "devolucao":
      return {
        icone: <Undo2 className={ic} />,
        titulo: `${i.usuarioNome} devolveu o carro`,
        detalhe: juntar(i.motivo ? MOTIVO[i.motivo] : null, km(i.odometroKm)),
      };
    case "carro_fixo":
      return {
        icone: <UserRound className={ic} />,
        titulo: i.acao === "definido" ? `Passou a ser o carro fixo de ${i.usuarioNome}` : `Deixou de ser o carro fixo de ${i.usuarioNome}`,
        detalhe: i.porNome ? `por ${i.porNome}` : "",
      };
    case "checklist":
      return {
        icone: <ClipboardCheck className={ic} />,
        titulo: `Checklist de ${i.momento === "saida" ? "saída" : "retorno"} · ${i.usuarioNome}`,
        detalhe: juntar(km(i.odometroKm), i.combustivelPct != null && `tanque ${i.combustivelPct}%`, i.avarias ? `avarias: ${i.avarias}` : "sem avarias"),
        tom: i.avarias ? "alerta" : undefined,
      };
    case "abastecimento":
      return {
        icone: <Fuel className={ic} />,
        titulo: `Abastecimento · ${i.litros.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} L de ${COMBUSTIVEL_ROTULO[i.combustivel].toLowerCase()}`,
        detalhe: juntar(real(i.valorTotal), km(i.km), i.tanqueCheio ? "tanque cheio" : "parcial", i.posto, i.responsavelNome),
      };
    case "manutencao":
      return {
        icone: <Wrench className={ic} />,
        titulo: `Manutenção feita: ${i.servico}`,
        detalhe: juntar(km(i.km), i.registradoPorNome && `registrada por ${i.registradoPorNome}`),
        tom: "ok",
      };
    case "alarme":
      return {
        icone: i.grave ? <AlertTriangle className={ic} /> : <ShieldCheck className={ic} />,
        titulo: EVENTO_RASTREADOR_ROTULO[i.evento],
        detalhe: "",
        tom: i.grave ? "alerta" : "ok",
      };
  }
}

/** A foto do painel, buscada com a sessao (a rota exige login) so quando o gestor abre. */
function FotoPainel({ checklistId, aberto, onFechar, titulo }: { checklistId: string; aberto: boolean; onFechar: () => void; titulo: string }) {
  const foto = useQuery({
    queryKey: ["frota", "checklist-foto", checklistId],
    enabled: aberto,
    staleTime: Infinity,
    queryFn: async () => URL.createObjectURL(await api.getBlob(`/frota/checklists/${checklistId}/foto`)),
  });
  // Libera a memoria da imagem quando o componente sai da tela.
  useEffect(() => () => void (foto.data && URL.revokeObjectURL(foto.data)), [foto.data]);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        {foto.isError ? (
          <ErrorState message="Não foi possível carregar a foto." onRetry={() => void foto.refetch()} />
        ) : foto.data ? (
          <img src={foto.data} alt={titulo} className="max-h-[70vh] w-full rounded-lg object-contain" />
        ) : (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Carregando foto" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Item({ item }: { item: ItemLinhaVeiculo }) {
  const [verFoto, setVerFoto] = useState(false);
  const v = visual(item);
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground",
          v.tom === "alerta" && "border-destructive/40 bg-destructive/10 text-destructive",
          v.tom === "ok" && "border-success/40 bg-success/10 text-success",
        )}
        aria-hidden
      >
        {v.icone}
      </span>
      <div className="min-w-0 flex-1 pb-3">
        <p className="text-sm">
          <span className="mr-1.5 tabular-nums text-muted-foreground">{item.tipo === "abastecimento" ? "—" : hora(item.em)}</span>
          <span className="font-medium">{v.titulo}</span>
        </p>
        {v.detalhe ? <p className="text-xs text-muted-foreground">{v.detalhe}</p> : null}
        {item.tipo === "checklist" && item.temFoto ? (
          <>
            <Button variant="outline" size="sm" className="mt-1.5" onClick={() => setVerFoto(true)}>
              <Camera className="size-4" aria-hidden />
              Foto do painel
            </Button>
            <FotoPainel
              checklistId={item.id}
              aberto={verFoto}
              onFechar={() => setVerFoto(false)}
              titulo={`Painel · checklist de ${item.momento === "saida" ? "saída" : "retorno"} · ${item.usuarioNome}`}
            />
          </>
        ) : null}
      </div>
    </li>
  );
}

export function LinhaDoTempoVeiculoCard({ veiculoId }: { veiculoId: string }) {
  const hoje = diaBrasileiroIso(new Date());
  const [janela, setJanela] = useState<(typeof JANELAS)[number]>(7);
  const [ate, setAte] = useState(hoje);
  const [filtros, setFiltros] = useState<Set<Filtro>>(new Set());
  const de = somarDias(ate, -(janela - 1));
  const incluiHoje = ate === hoje;

  const linha = useQuery({
    queryKey: ["frota", "linha-do-tempo", veiculoId, de, ate],
    queryFn: () => api.get<LinhaDoVeiculo>(`/frota/veiculos/${veiculoId}/linha-do-tempo?de=${de}&ate=${ate}`),
    refetchInterval: incluiHoje ? 60_000 : false,
    staleTime: incluiHoje ? 30_000 : Infinity,
  });

  const tiposVisiveis = filtros.size === 0 ? null : new Set(FILTROS.filter((f) => filtros.has(f.id)).flatMap((f) => f.tipos));
  const dias = (linha.data?.dias ?? [])
    .map((d) => ({ ...d, itens: tiposVisiveis ? d.itens.filter((i) => tiposVisiveis.has(i.tipo)) : d.itens }))
    .filter((d) => d.itens.length > 0);

  function alternar(f: Filtro) {
    setFiltros((atual) => {
      const novo = new Set(atual);
      if (novo.has(f)) novo.delete(f);
      else novo.add(f);
      return novo;
    });
  }

  return (
    <Card>
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-primary" aria-hidden />
            Linha do tempo
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Período anterior" onClick={() => setAte(somarDias(ate, -janela))}>
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Tamanho do período">
              {JANELAS.map((j) => (
                <Button
                  key={j}
                  variant={janela === j ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={janela === j}
                  onClick={() => setJanela(j)}
                >
                  {j} dias
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Período seguinte"
              disabled={incluiHoje}
              onClick={() => {
                const novo = somarDias(ate, janela);
                setAte(novo > hoje ? hoje : novo);
              }}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {incluiHoje ? `Últimos ${janela} dias` : `${dataCurta(de)} a ${dataCurta(ate)}`}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
          {FILTROS.map((f) => (
            <Button
              key={f.id}
              variant={filtros.has(f.id) ? "secondary" : "outline"}
              size="sm"
              aria-pressed={filtros.has(f.id)}
              onClick={() => alternar(f.id)}
            >
              {f.rotulo}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent>
        {linha.isError ? (
          <ErrorState message="Não foi possível carregar a linha do tempo." onRetry={() => void linha.refetch()} />
        ) : linha.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : dias.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {filtros.size > 0 ? "Nada desse tipo no período." : "Nada registrado com este carro no período."}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {linha.data.truncado ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" role="status">
                Muitos registros neste período: a lista pode estar incompleta. Escolha 7 dias para ver tudo.
              </p>
            ) : null}
            {dias.map((d) => (
              <section key={d.dia} aria-label={rotuloDia(d.dia, hoje)}>
                <h3 className="mb-2 text-sm font-semibold capitalize">{rotuloDia(d.dia, hoje)}</h3>
                <ol className="flex flex-col">
                  {d.itens.map((i, n) => (
                    <Item key={`${i.tipo}-${i.em}-${n}`} item={i} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
