import { useState } from "react";
import { Bookmark, BookmarkPlus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Recortes da fila com nome: "sem técnico de hoje", "NetGo atrasadas". Uma
 * visão e so a query string que a tela ja escreve na URL — aplicar e reler
 * a URL; salvar e guardar a atual. Vive no navegador (localStorage), por
 * equipe (Painel e Retiradas tem filtros diferentes).
 *
 * ponytail: por navegador, nao por usuario; vira preferencia no servidor se
 * alguem pedir pra ver as mesmas visoes em outro computador.
 */
type Visao = { nome: string; qs: string };

function chave(equipe: string) {
  return `isphub.fila.visoes.${equipe}`;
}
function ler(equipe: string): Visao[] {
  try {
    const v = JSON.parse(localStorage.getItem(chave(equipe)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x?.nome === "string" && typeof x?.qs === "string") : [];
  } catch {
    return [];
  }
}

export function VisoesSalvas({
  equipe,
  qsAtual,
  temFiltro,
  onAplicar,
}: {
  equipe: string;
  /** Query string do recorte em tela (o que seria salvo). */
  qsAtual: string;
  /** Sem filtro ativo nao ha o que salvar — o botao explica em vez de sumir. */
  temFiltro: boolean;
  onAplicar: (qs: string) => void;
}) {
  const [visoes, setVisoes] = useState<Visao[]>(() => ler(equipe));
  const [nome, setNome] = useState("");
  const [aberto, setAberto] = useState(false);

  function gravar(lista: Visao[]) {
    setVisoes(lista);
    try {
      localStorage.setItem(chave(equipe), JSON.stringify(lista));
    } catch {
      /* modo privado/cota: a visao vale ate fechar a aba */
    }
  }
  function salvar() {
    const n = nome.trim();
    if (!n) return;
    // Mesmo nome substitui: e o jeito de "atualizar" uma visao.
    gravar([...visoes.filter((v) => v.nome !== n), { nome: n, qs: qsAtual }]);
    setNome("");
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
          aria-label="Visões salvas"
        >
          <Bookmark className="size-3.5" aria-hidden />
          Visões
          {visoes.length > 0 && <span className="tabular-nums text-muted-foreground/70">({visoes.length})</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        {visoes.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Nenhuma visão salva. Filtre a fila como quiser e dê um nome aqui embaixo.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {visoes.map((v) => (
              <li key={v.nome} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onAplicar(v.qs);
                    setAberto(false);
                  }}
                  className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
                >
                  {v.nome}
                </button>
                <button
                  type="button"
                  onClick={() => gravar(visoes.filter((x) => x.nome !== v.nome))}
                  className="rounded p-1 text-muted-foreground/60 hover:bg-secondary hover:text-destructive"
                  aria-label={`Remover visão ${v.nome}`}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-2 flex items-center gap-1.5 border-t border-border pt-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            salvar();
          }}
        >
          <Input
            value={nome}
            onChange={(ev) => setNome(ev.target.value)}
            placeholder={temFiltro ? "Nome da visão atual" : "Filtre a fila antes de salvar"}
            disabled={!temFiltro}
            aria-label="Nome da visão"
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!temFiltro || !nome.trim()} aria-label="Salvar visão atual">
            <BookmarkPlus className="size-4" />
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
