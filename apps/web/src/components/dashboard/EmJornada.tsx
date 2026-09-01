import { useEffect, useState } from "react";
import { Clock, AlertTriangle, PauseCircle, Truck, Users } from "lucide-react";
import {
  MOTIVO_PAUSA_LABEL,
  formatarDuracao,
  formatarTrabalhado,
  jornadaPrecisaAtencao,
  msEmPausa,
  pausaAberta,
  type TecnicoEmJornada,
} from "@isphub/shared";
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
        const pausa = pausaAberta(t.pausas);
        const parado = msEmPausa(t.pausas, agora);
        return (
          <li
            key={t.usuarioId}
            className="flex flex-col gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <Avatar nome={t.nomeExibicao || t.nome} size="sm" online={!pausa} />
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

                O número em destaque é o TRABALHADO, não o decorrido: é o que o
                supervisor usa pra medir o dia, e contar o almoço nele infla
                todo mundo na mesma medida.
              */}
              <span
                className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${
                  longa ? "text-warning" : pausa ? "text-muted-foreground" : "text-foreground"
                }`}
                title={
                  longa
                    ? "Aberta há mais de 12h — pode ter esquecido de encerrar"
                    : `Trabalhado (descontadas as pausas). Em serviço há ${formatarDuracao(t.inicioEm, agora)}.`
                }
              >
                {longa ? <AlertTriangle className="size-3.5" aria-hidden /> : <Clock className="size-3.5" aria-hidden />}
                {formatarTrabalhado(t.inicioEm, t.pausas, agora)}
              </span>
            </div>

            {/*
              A sublinha só aparece quando há o que dizer. Uma linha de metadados
              sempre presente e sempre vazia treina o olho a ignorá-la.
            */}
            {pausa || t.veiculoPlaca || parado > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-xs text-muted-foreground">
                {pausa ? (
                  <span /*
                      Sem cor de status: `--info` nao existe neste design system
                      (so destructive/warning/success), e pausa nao e nenhum dos
                      tres — almocar nao e problema nem conquista. O peso da
                      enfase, o icone da o significado.
                    */
                    className="inline-flex items-center gap-1 font-medium text-foreground">
                    <PauseCircle className="size-3.5" aria-hidden />
                    Em {MOTIVO_PAUSA_LABEL[pausa.motivo].toLowerCase()} desde{" "}
                    {new Date(pausa.inicioEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                ) : parado > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <PauseCircle className="size-3.5" aria-hidden />
                    {Math.round(parado / 60_000)} min parado hoje
                  </span>
                ) : null}
                {t.veiculoPlaca ? (
                  <span className="inline-flex items-center gap-1">
                    <Truck className="size-3.5" aria-hidden />
                    {t.veiculoPlaca}
                  </span>
                ) : null}
                {t.companhia.length > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden />
                    com {t.companhia.join(", ")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
