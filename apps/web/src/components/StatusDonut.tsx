import { OS_STATUS_LABEL, OsStatus } from "@isphub/shared";

/**
 * Cor por status — paleta de acento DECORATIVA (nao o semaforo de SLA). Cada
 * status e uma categoria informativa aqui, nao um sinal de urgencia — por
 * isso pode usar o espectro cheio de acentos sem competir com o vermelho/
 * ambar/verde reservados do SlaBadge.
 */
const COR_STATUS: Record<OsStatus, string> = {
  [OsStatus.ABERTA]: "var(--accent-blue)",
  [OsStatus.PENDENTE]: "var(--accent-yellow)",
  [OsStatus.EM_DESLOCAMENTO]: "var(--accent-orange)",
  [OsStatus.EM_EXECUCAO]: "var(--accent-teal)",
  [OsStatus.CONCLUIDA]: "var(--accent-green)",
  [OsStatus.CANCELADA]: "var(--accent-pink)",
};

/**
 * Donut de distribuicao por status — SVG puro via stroke-dasharray (sem lib
 * de grafico: e um unico anel com poucas fatias, nao justifica a dependencia).
 * Anel de fundo em --secondary; svg rotacionado -90deg pra fatia comecar as
 * 12h (padrao de donut), texto central contra-rotacionado pra ficar ereto.
 */
export function StatusDonut({ dados }: { dados: { status: OsStatus; total: number }[] }) {
  const total = dados.reduce((acc, d) => acc + d.total, 0);
  const raio = 42;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
      <svg viewBox="0 0 100 100" className="size-40 shrink-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={raio} fill="none" stroke="var(--secondary)" strokeWidth={14} />
        {total > 0 &&
          dados
            .filter((d) => d.total > 0)
            .map((d) => {
              const fatia = (d.total / total) * circunferencia;
              const offset = acumulado;
              acumulado += fatia;
              return (
                <circle
                  key={d.status}
                  cx="50"
                  cy="50"
                  r={raio}
                  fill="none"
                  stroke={COR_STATUS[d.status]}
                  strokeWidth={14}
                  strokeDasharray={`${fatia} ${circunferencia - fatia}`}
                  strokeDashoffset={-offset}
                />
              );
            })}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          className="rotate-90 fill-foreground font-display font-bold"
          style={{ transformOrigin: "50px 50px", fontSize: "20px" }}
        >
          {total}
        </text>
      </svg>
      <ul className="flex w-full flex-col gap-2">
        {dados.map((d) => (
          <li key={d.status} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-foreground">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: COR_STATUS[d.status] }} />
              {OS_STATUS_LABEL[d.status]}
            </span>
            <span className="tabular-nums text-muted-foreground">{d.total}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
