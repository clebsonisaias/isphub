import type { Categoria, Provedor } from "@isphub/shared";
import { OsPrioridade, OsStatus } from "@isphub/shared";
import { cn } from "@/lib/utils";
import {
  OS_STATUS_LABEL,
  PRIORIDADE_LABEL,
  STATUS_ORDEM,
  type FilaFacetCounts,
  type FilaFacetState,
} from "@/lib/filaFacets";
import { iconeCategoria } from "@/lib/categoriaIcons";
import { CountUp } from "@/components/CountUp";
import { LayoutList, HelpCircle, UserCheck, UserPlus } from "lucide-react";

interface Props {
  filtros: FilaFacetState;
  facetas: FilaFacetCounts;
  provedores: Provedor[];
  categorias: Categoria[];
  mostrarProvedores: boolean;
  /** Total de OS do lote da aba ativa (sem nenhum filtro) — mostrado em "Todas as OS". */
  totalOs: number;
  onChange: (patch: Partial<FilaFacetState>) => void;
}

/** Uma linha "rótulo … contagem", clicável, com estado ativo destacado. */
function LinhaFiltro({
  label,
  count,
  ativo,
  onClick,
  cor,
  icon,
}: {
  label: string;
  count?: number;
  ativo: boolean;
  onClick: () => void;
  cor?: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors pointer-coarse:min-h-11",
        ativo ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {cor && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: cor }} />}
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 text-xs tabular-nums",
            ativo ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
          )}
        >
          {/* Tween curto no numero ao mudar (filtro, sync) — mesmo CountUp do
              Dashboard, reduced-motion e cleanup ja resolvidos la. */}
          <CountUp value={count} />
        </span>
      )}
    </button>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2.5 pb-1 pt-3 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {titulo}
      </p>
      {children}
    </div>
  );
}

export function FilaSidebar({ filtros, facetas, provedores, categorias, mostrarProvedores, totalOs, onChange }: Props) {
  return (
    <nav className="flex flex-col gap-1">
      <Secao titulo="Ordens de serviço">
        <LinhaFiltro
          label="Todas as OS"
          count={totalOs}
          ativo={
            filtros.status === "todos" &&
            filtros.prioridade === "todas" &&
            filtros.categoriaId === "todas" &&
            filtros.provedorId === "todos" &&
            filtros.tecnicoId === "todos"
          }
          onClick={() =>
            onChange({
              status: "todos",
              prioridade: "todas",
              categoriaId: "todas",
              provedorId: "todos",
              tecnicoId: "todos",
            })
          }
          icon={<LayoutList className="size-4 shrink-0" />}
        />
      </Secao>

      {/*
        DESPACHO vem logo depois de "Todas as OS", antes de Categoria: a
        primeira pergunta de quem abre esta tela e "o que falta despachar", nao
        "que tipo de servico e". Antes isso exigia varrer a lista procurando
        cards sem tecnico.
      */}
      <Secao titulo="Despacho">
        <LinhaFiltro
          label="Todas"
          ativo={filtros.tecnicoId === "todos"}
          onClick={() => onChange({ tecnicoId: "todos" })}
        />
        {/*
          "A despachar" aparece mesmo com zero — e a unica linha cuja AUSENCIA
          e informacao: some da tela justamente quando a fila esta em dia, e ai
          quem olha nao sabe se acabou ou se o filtro sumiu.
        */}
        <LinhaFiltro
          label="A despachar"
          icon={<UserPlus className="size-3.5 shrink-0 text-warning" />}
          count={facetas.porTecnico.get("a_despachar") ?? 0}
          ativo={filtros.tecnicoId === "a_despachar"}
          onClick={() => onChange({ tecnicoId: "a_despachar" })}
        />
        {facetas.tecnicos.map((t) => (
          <LinhaFiltro
            key={t.id}
            label={t.nome}
            icon={<UserCheck className="size-3.5 shrink-0 text-muted-foreground" />}
            count={t.total}
            ativo={filtros.tecnicoId === t.id}
            onClick={() => onChange({ tecnicoId: t.id })}
          />
        ))}
        {facetas.tecnicos.length === 0 && (facetas.porTecnico.get("a_despachar") ?? 0) === 0 && (
          <p className="px-3 py-1.5 text-xs text-muted-foreground">Nenhuma OS neste recorte.</p>
        )}
      </Secao>

      <Secao titulo="Categoria">
        <LinhaFiltro
          label="Todas"
          ativo={filtros.categoriaId === "todas"}
          onClick={() => onChange({ categoriaId: "todas" })}
        />
        {categorias.map((c) => {
          const Icone = iconeCategoria(c.icone);
          return (
            <LinhaFiltro
              key={c.id}
              label={c.nome}
              icon={<Icone className="size-3.5 shrink-0" style={{ color: c.cor }} />}
              count={facetas.porCategoria.get(c.id) ?? 0}
              ativo={filtros.categoriaId === c.id}
              onClick={() => onChange({ categoriaId: c.id })}
            />
          );
        })}
        {((facetas.porCategoria.get("sem_categoria") ?? 0) > 0 || filtros.categoriaId === "sem_categoria") && (
          <LinhaFiltro
            label="Não classificado"
            icon={<HelpCircle className="size-3.5 shrink-0 text-warning" />}
            count={facetas.porCategoria.get("sem_categoria") ?? 0}
            ativo={filtros.categoriaId === "sem_categoria"}
            onClick={() => onChange({ categoriaId: "sem_categoria" })}
          />
        )}
      </Secao>

      <Secao titulo="Status">
        <LinhaFiltro
          label="Todos"
          count={facetas.porStatus.size ? [...facetas.porStatus.values()].reduce((a, b) => a + b, 0) : 0}
          ativo={filtros.status === "todos"}
          onClick={() => onChange({ status: "todos" })}
        />
        {STATUS_ORDEM.filter((s) => (facetas.porStatus.get(s) ?? 0) > 0 || filtros.status === s).map((s) => (
          <LinhaFiltro
            key={s}
            label={OS_STATUS_LABEL[s as OsStatus]}
            count={facetas.porStatus.get(s) ?? 0}
            ativo={filtros.status === s}
            onClick={() => onChange({ status: s })}
          />
        ))}
      </Secao>

      <Secao titulo="Prioridade">
        <LinhaFiltro
          label="Todas"
          ativo={filtros.prioridade === "todas"}
          onClick={() => onChange({ prioridade: "todas" })}
        />
        {[OsPrioridade.ALTA, OsPrioridade.NORMAL, OsPrioridade.BAIXA].map((p) => (
          <LinhaFiltro
            key={p}
            label={PRIORIDADE_LABEL[p]}
            count={facetas.porPrioridade.get(p) ?? 0}
            ativo={filtros.prioridade === p}
            onClick={() => onChange({ prioridade: p })}
          />
        ))}
      </Secao>

      {mostrarProvedores && provedores.length > 0 && (
        <Secao titulo="Provedores">
          <LinhaFiltro
            label="Todos"
            ativo={filtros.provedorId === "todos"}
            onClick={() => onChange({ provedorId: "todos" })}
          />
          {provedores.map((p) => (
            <LinhaFiltro
              key={p.id}
              label={p.nome}
              cor={p.cor}
              count={facetas.porProvedor.get(p.id) ?? 0}
              ativo={filtros.provedorId === p.id}
              onClick={() => onChange({ provedorId: p.id })}
            />
          ))}
        </Secao>
      )}
    </nav>
  );
}
