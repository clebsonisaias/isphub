import { useEffect, useState } from "react";
import { ROTULO_TURNO, TURNOS_AGENDA, type FilaItem, type TurnoAgenda, type VagaTurno } from "@isphub/shared";
import { CalendarDays } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { agendaApi, diaISO, rotuloDiaAgenda, rotuloVisita, type GradeResposta } from "@/lib/agendaApi";
import { ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";

/**
 * Escolher o dia e o turno da visita de UMA OS — a mesma pergunta que a
 * atendente faz ao cliente no AtendAI, agora respondida pelo supervisor no
 * painel. A grade vem pronta do servidor (`/agenda/vagas`), com bloqueio e
 * motivo; esta tela so desenha e manda a escolha pra `POST /agenda`, que
 * marca ou remarca (a chave e a OS).
 */

function motivoCurto(v: VagaTurno): string {
  switch (v.bloqueio) {
    case "lotado":
      return "Lotado";
    case "dia_lotado":
      return "Dia lotado";
    case "regiao":
      return "Região cheia";
    case "feriado":
      return v.motivoBloqueio ?? "Feriado";
    case "dia_nao_atendido":
      return "Sem atendimento";
    case "turno_nao_atendido":
      return "Só manhã";
    case "sem_equipe":
      return "Sem equipe";
    case "antecedencia":
      return "Prazo curto";
    default:
      return `${v.livres} livre${v.livres === 1 ? "" : "s"}`;
  }
}

function mensagem(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Não foi possível marcar a visita.";
}

export function MarcarVisitaDialog({
  item,
  onClose,
  onMarcado,
}: {
  item: FilaItem;
  onClose: () => void;
  /** Dia, turno e id da marcacao que ficaram gravados (o id e o que desmarca). */
  onMarcado: (dia: string, turno: TurnoAgenda, agendamentoId: string) => void;
}) {
  const { toast } = useToast();
  const [grade, setGrade] = useState<GradeResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);

  // A regiao entra pelo teto regional: pop vem sempre do SGP, bairro so
  // depois do backfill — a mesma preferencia que `Agendamento.regiao` usa.
  const regiao = item.pop ?? item.endereco?.bairro ?? undefined;

  useEffect(() => {
    let cancelado = false;
    const hoje = diaISO(new Date());
    setErro(null);
    agendaApi
      .grade({ de: hoje, regiao })
      .then((g) => !cancelado && setGrade(g))
      .catch((e) => !cancelado && setErro(mensagem(e)));
    return () => {
      cancelado = true;
    };
  }, [regiao]);

  // A grade chega plana (dia×turno); a tela mostra um dia por linha.
  const dias = new Map<string, Partial<Record<TurnoAgenda, VagaTurno>>>();
  for (const v of grade?.vagas ?? []) {
    const linha = dias.get(v.dia) ?? {};
    linha[v.turno] = v;
    dias.set(v.dia, linha);
  }

  const atual = item.diaAgenda && item.turnoAgenda ? { dia: item.diaAgenda, turno: item.turnoAgenda } : null;

  async function marcar(dia: string, turno: TurnoAgenda) {
    const chave = `${dia}|${turno}`;
    setMarcando(chave);
    try {
      const { id } = await agendaApi.marcar({ provedorId: item.provedorId, sgpOsId: item.sgpOsId, dia, turno, regiao: regiao ?? null });
      toast({ titulo: atual ? "Visita remarcada" : "Visita marcada", descricao: rotuloVisita(dia, turno), variante: "sucesso" });
      onMarcado(dia, turno, id);
    } catch (e) {
      // 409 ja vem com o motivo certo do servidor ("Turno lotado", "Sabado so
      // tem atendimento de manha"); recarrega a grade porque alguem passou na frente.
      toast({ titulo: "Não deu para marcar", descricao: mensagem(e), variante: "erro" });
      agendaApi.grade({ de: diaISO(new Date()), regiao }).then(setGrade).catch(() => {});
    } finally {
      setMarcando(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            {atual ? "Remarcar visita" : "Marcar visita"}
          </DialogTitle>
          <DialogDescription>
            OS #{item.sgpOsId} · {item.clienteNome ?? "Cliente não identificado"}
            {regiao ? ` · ${regiao}` : ""}
            {atual ? ` · hoje: ${rotuloVisita(atual.dia, atual.turno)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !grade ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1.5 text-sm">
              <span />
              {TURNOS_AGENDA.map((t) => (
                <span key={t} className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {ROTULO_TURNO[t]}
                </span>
              ))}
              {[...dias.entries()].map(([dia, turnos]) => (
                <DiaLinha
                  key={dia}
                  dia={dia}
                  turnos={turnos}
                  atual={atual}
                  marcando={marcando}
                  onEscolher={(turno) => void marcar(dia, turno)}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DiaLinha({
  dia,
  turnos,
  atual,
  marcando,
  onEscolher,
}: {
  dia: string;
  turnos: Partial<Record<TurnoAgenda, VagaTurno>>;
  atual: { dia: string; turno: TurnoAgenda } | null;
  marcando: string | null;
  onEscolher: (turno: TurnoAgenda) => void;
}) {
  const diaFechado = TURNOS_AGENDA.every((t) => {
    const b = turnos[t]?.bloqueio;
    return b === "feriado" || b === "dia_nao_atendido";
  });
  return (
    <>
      <span className={`whitespace-nowrap font-medium ${diaFechado ? "text-muted-foreground" : ""}`}>{rotuloDiaAgenda(dia)}</span>
      {TURNOS_AGENDA.map((turno) => {
        const v = turnos[turno];
        if (!v) return <span key={turno} />;
        const ehAtual = atual?.dia === dia && atual.turno === turno;
        const livre = v.bloqueio === null && v.livres > 0;
        const ocupado = marcando === `${dia}|${turno}`;
        return (
          <button
            key={turno}
            type="button"
            disabled={!livre || marcando !== null || ehAtual}
            onClick={() => onEscolher(turno)}
            aria-label={`${rotuloDiaAgenda(dia)}, ${ROTULO_TURNO[turno]}: ${ehAtual ? "visita atual" : motivoCurto(v)}`}
            className={[
              "flex h-10 flex-col items-center justify-center rounded-md border text-xs leading-tight transition-colors",
              ehAtual
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : livre
                  ? "border-border bg-background hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  : "cursor-not-allowed border-transparent bg-muted/40 text-muted-foreground",
              livre && v.livres <= 3 ? "text-amber-700 dark:text-amber-400" : "",
            ].join(" ")}
          >
            {ocupado ? "Marcando…" : ehAtual ? "Atual" : motivoCurto(v)}
            {livre && !ehAtual && (
              <span className="text-[10px] font-normal text-muted-foreground">
                {v.ocupadas}/{v.capacidade}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
