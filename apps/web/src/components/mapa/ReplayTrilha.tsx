import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PontoTrilha } from "@/lib/veiculosApi";

interface ReplayTrilhaProps {
  pontos: PontoTrilha[];
  indice: number;
  aoMudarIndice: (idx: number) => void;
}

const VELOCIDADES = [1, 2, 5, 10] as const;

export function ReplayTrilha({ pontos, indice, aoMudarIndice }: ReplayTrilhaProps) {
  const [tocando, setTocando] = useState(false);
  const [velocidade, setVelocidade] = useState<(typeof VELOCIDADES)[number]>(2);

  useEffect(() => {
    setTocando(false);
    aoMudarIndice(0);
  }, [pontos, aoMudarIndice]);

  useEffect(() => {
    if (!tocando || pontos.length < 2) return;
    const intervaloMs = Math.max(80, Math.round(500 / velocidade));
    const timer = window.setInterval(() => {
      aoMudarIndice(indice + 1 >= pontos.length ? 0 : indice + 1);
    }, intervaloMs);
    return () => window.clearInterval(timer);
  }, [tocando, velocidade, indice, pontos.length, aoMudarIndice]);

  if (pontos.length < 2) return null;

  const atual = pontos[Math.min(indice, pontos.length - 1)]!;
  const hora = new Date(atual.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <Button
        size="icon"
        variant="outline"
        className="h-7 w-7"
        onClick={() => setTocando((v) => !v)}
        title={tocando ? "Pausar replay" : "Iniciar replay da rota"}
      >
        {tocando ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={() => {
          setTocando(false);
          aoMudarIndice(0);
        }}
        title="Reiniciar"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>

      <input
        type="range"
        min={0}
        max={pontos.length - 1}
        value={Math.min(indice, pontos.length - 1)}
        onChange={(e) => {
          setTocando(false);
          aoMudarIndice(Number(e.target.value));
        }}
        className="min-w-[120px] flex-1 accent-primary"
      />

      <span className="font-mono text-muted-foreground">
        {hora}
        {atual.velocidadeKmh != null ? ` • ${Math.round(atual.velocidadeKmh)} km/h` : ""}
      </span>

      <div className="flex items-center gap-1">
        {VELOCIDADES.map((v) => (
          <Button
            key={v}
            size="sm"
            variant={velocidade === v ? "default" : "outline"}
            className="h-6 px-1.5 text-[11px]"
            onClick={() => setVelocidade(v)}
          >
            {v}x
          </Button>
        ))}
      </div>
    </div>
  );
}
