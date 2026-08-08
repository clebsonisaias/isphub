import { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { formatarDuracao, jornadaPrecisaAtencao, type TecnicoEmJornada } from "@isphub/shared";
import { Avatar } from "@/components/Avatar";

/**
 * Quem está em serviço agora.
 *
 * Existe porque despachar sem saber quem está na rua é adivinhação: o gestor
 * abria a fila e escolhia um técnico pelo nome, sem nenhum sinal de se aquela
 * pessoa já tinha ido embora.
 *
 * O tempo é calculado com as MESMAS funções que o app do técnico usa
 * (`@isphub/shared`) — se cada lado fizesse a própria conta, o técnico e o
 * gestor veriam durações diferentes para a mesma jornada, e nenhum dos dois
 * saberia qual acreditar.
 */
export function EmJornada({ tecnicos }: { tecnicos: TecnicoEmJornada[] }) {
  /*
   * Relógio local com tique de 30s. Aqui o relógio do NAVEGADOR serve: é a
   * máquina do escritório, e o número é aproximado por natureza ("há ~5h"). No
   * app do técnico não serve, porque lá o mesmo número é o que a pessoa confere
   * sobre o próprio dia.
   */
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (tecnicos.length === 0) {
    return <p className="text-sm text-muted-foreground">Ninguém em jornada no momento.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {tecnicos.map((t) => {
        const longa = jornadaPrecisaAtencao(t.inicioEm, agora);
        return (
          <li
            key={t.usuarioId}
            className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2"
          >
            <Avatar nome={t.nomeExibicao || t.nome} size="sm" online />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.nomeExibicao || t.nome}</p>
              <p className="text-xs text-muted-foreground">
                Desde {new Date(t.inicioEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            {/*
              Ícone + cor, nunca só cor: quem não distingue verde de âmbar
              precisa do mesmo aviso. Além disso o número é tabular, senão a
              coluna dança a cada minuto que vira.
            */}
            <span
              className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${
                longa ? "text-warning" : "text-muted-foreground"
              }`}
              title={longa ? "Aberta há mais de 12h — pode ter esquecido de encerrar" : "Tempo em serviço"}
            >
              {longa ? <AlertTriangle className="size-3.5" aria-hidden /> : <Clock className="size-3.5" aria-hidden />}
              {formatarDuracao(t.inicioEm, agora)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
