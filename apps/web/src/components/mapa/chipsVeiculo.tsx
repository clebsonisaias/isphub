import { Battery, BatteryLow, KeyRound, Lock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Os chips de estado de um veiculo — ignicao, bateria e bloqueio.
 *
 * Um componente so, usado no popup do pino E na lista ao lado, porque os dois
 * respondem a mesma pergunta e divergir seria pior que nao mostrar. E a razao de
 * ele receber os tres campos crus em vez de uma string pronta.
 *
 * DUAS regras que valem para todos:
 *
 * 1. **`null` nao vira chip.** Tri-estado: `null` e "o aparelho nao contou",
 *    nao "esta desligado". Um chip cinza dizendo "desligado" afirmaria o que
 *    ninguem mediu — o mesmo erro que a integracao de referencia comete ao ler
 *    o status errado e mostrar tudo como falso.
 *
 * 2. **Nunca so cor.** Todo chip tem icone E texto. Quem nao distingue verde de
 *    vermelho precisa do mesmo aviso, e num painel operacional o aviso e o
 *    produto.
 */
export function ChipsVeiculo({
  ignicao,
  bateriaPct,
  bloqueado,
  compacto,
}: {
  ignicao: "ligada" | "desligada" | "anomalia" | null;
  bateriaPct: number | null;
  bloqueado: boolean | null;
  /** Na lista, sem os rotulos longos — o espaco e de 320px. */
  compacto?: boolean;
}) {
  const chips: { chave: string; icone: React.ReactNode; texto: string; tom: string }[] = [];

  if (ignicao === "ligada") {
    chips.push({
      chave: "ig",
      icone: <KeyRound className="size-3" aria-hidden />,
      texto: compacto ? "ligada" : "ignição ligada",
      tom: "bg-success/10 text-success",
    });
  } else if (ignicao === "anomalia") {
    /*
     * `ANOMALY` do fornecedor tem chip PROPRIO, e nao vira "desligada": e o
     * sensor de ignicao com defeito. Confundir os dois diria que o motor esta
     * desligado quando ninguem sabe.
     */
    chips.push({
      chave: "ig",
      icone: <TriangleAlert className="size-3" aria-hidden />,
      texto: "ignição com problema",
      tom: "bg-warning/10 text-warning",
    });
  }

  if (bateriaPct !== null) {
    // 15% e a faixa `danger` do FORNECEDOR, nao um numero meu — a mesma que
    // `severidadeSensor` aplica no painel de sensores.
    const fraca = bateriaPct <= 15;
    chips.push({
      chave: "bat",
      icone: fraca ? <BatteryLow className="size-3" aria-hidden /> : <Battery className="size-3" aria-hidden />,
      texto: `${bateriaPct}%`,
      tom: fraca ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
    });
  }

  if (bloqueado === true) {
    chips.push({
      chave: "cut",
      icone: <Lock className="size-3" aria-hidden />,
      texto: "bloqueado",
      tom: "bg-destructive/10 text-destructive",
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((c) => (
        <span
          key={c.chave}
          className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium", c.tom)}
        >
          {c.icone}
          {c.texto}
        </span>
      ))}
    </div>
  );
}
