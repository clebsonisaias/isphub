import { useEffect, useState } from "react";
import type { OsFichaSgp } from "@isphub/shared";
import { ordensServicoApi } from "@/lib/filaApi";
import { Eye, EyeOff, Copy, Check, MapPin } from "lucide-react";

/**
 * Ficha da OS lida ao vivo do SGP — o que o espelho local nao tem.
 *
 * Carrega DEPOIS do dialog abrir e falha em silencio: o detalhe da OS vem do
 * espelho e nao pode ficar preso esperando o ERP do provedor. Se o SGP nao
 * responder, este bloco simplesmente nao aparece.
 *
 * No escritorio isto vale tanto quanto em campo: e daqui que o atendente dita
 * o PPPoE pro tecnico no telefone e confere se o plano bate com a reclamacao.
 */
export function FichaSgpOs({ ordemServicoId }: { ordemServicoId: string }) {
  const [ficha, setFicha] = useState<OsFichaSgp | null>(null);
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setFicha(null);
    setSenhaVisivel(false);
    ordensServicoApi
      .fichaSgp(ordemServicoId)
      .then((f) => {
        if (!cancelado) setFicha(f);
      })
      // Silencioso de proposito: a ficha ENRIQUECE a tela, nao a sustenta.
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [ordemServicoId]);

  if (!ficha) return null;

  async function copiar(rotulo: string, valor: string) {
    await navigator.clipboard.writeText(valor);
    setCopiado(rotulo);
    setTimeout(() => setCopiado(null), 1500);
  }

  const temPlano = ficha.plano || ficha.planoDownload || ficha.planoUpload || ficha.servicoOnline !== null;
  const temPppoe = ficha.servicoLogin || ficha.servicoSenha;
  const temLocal = ficha.enderecoComplemento || ficha.enderecoPontoReferencia;
  const temEquipe = ficha.tecnicoResponsavel || ficha.tecnicosAuxiliares.length > 0 || ficha.setor;
  const temRegistro = ficha.servicoPrestado || ficha.observacao;

  return (
    <div className="flex flex-col gap-4">
      {temPlano && (
        <Bloco titulo="Plano contratado">
          <div className="flex flex-wrap items-center gap-2">
            {ficha.plano && <span className="font-semibold text-foreground">{ficha.plano}</span>}
            {ficha.planoDownload && <Chip>↓ {ficha.planoDownload}</Chip>}
            {ficha.planoUpload && <Chip>↑ {ficha.planoUpload}</Chip>}
            {/* Verde/vermelho aqui e semantico de verdade: e o servico do cliente. */}
            {ficha.servicoOnline !== null && (
              <span
                className={
                  ficha.servicoOnline
                    ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600"
                    : "rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600"
                }
              >
                {ficha.servicoOnline ? "Online" : "Offline"}
              </span>
            )}
          </div>
          {(ficha.servicoIp || ficha.servicoMac) && (
            <p className="font-mono text-xs text-muted-foreground">
              {[ficha.servicoIp, ficha.servicoMac].filter(Boolean).join(" · ")}
            </p>
          )}
        </Bloco>
      )}

      {temPppoe && (
        <Bloco titulo="Acesso PPPoE">
          <div className="flex flex-col gap-2">
            {ficha.servicoLogin && (
              <Credencial
                rotulo="Login"
                valor={ficha.servicoLogin}
                copiado={copiado === "login"}
                onCopiar={() => void copiar("login", ficha.servicoLogin!)}
              />
            )}
            {ficha.servicoSenha && (
              <Credencial
                rotulo="Senha"
                valor={senhaVisivel ? ficha.servicoSenha : "•".repeat(Math.min(ficha.servicoSenha.length, 12))}
                copiado={copiado === "senha"}
                onCopiar={() => void copiar("senha", ficha.servicoSenha!)}
                onAlternarVisibilidade={() => setSenhaVisivel((v) => !v)}
                visivel={senhaVisivel}
              />
            )}
          </div>
        </Bloco>
      )}

      {temLocal && (
        <Bloco titulo="Como chegar">
          {ficha.enderecoComplemento && <p className="text-sm text-foreground">{ficha.enderecoComplemento}</p>}
          {ficha.enderecoPontoReferencia && (
            <p className="flex items-start gap-1.5 text-sm text-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>{ficha.enderecoPontoReferencia}</span>
            </p>
          )}
        </Bloco>
      )}

      {temRegistro && (
        <Bloco titulo="Registrado na OS">
          {ficha.servicoPrestado && <Linha rotulo="Serviço prestado" valor={ficha.servicoPrestado} />}
          {ficha.observacao && <Linha rotulo="Observação" valor={ficha.observacao} />}
        </Bloco>
      )}

      {temEquipe && (
        <Bloco titulo="Equipe e setor">
          {ficha.tecnicoResponsavel && <Linha rotulo="Responsável" valor={ficha.tecnicoResponsavel} />}
          {ficha.tecnicosAuxiliares.length > 0 && <Linha rotulo="Apoio" valor={ficha.tecnicosAuxiliares.join(", ")} />}
          {ficha.setor && <Linha rotulo="Setor" valor={ficha.setor} />}
        </Bloco>
      )}
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      {children}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{children}</span>;
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="text-sm text-foreground">{valor}</p>
    </div>
  );
}

/**
 * Credencial com copiar (e revelar, na senha). Copiar existe porque ditar
 * login/senha de PPPoE por telefone e onde nascem os erros de configuracao.
 */
function Credencial({
  rotulo,
  valor,
  copiado,
  onCopiar,
  onAlternarVisibilidade,
  visivel,
}: {
  rotulo: string;
  valor: string;
  copiado: boolean;
  onCopiar: () => void;
  onAlternarVisibilidade?: () => void;
  visivel?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <p className="truncate font-mono text-sm text-foreground">{valor}</p>
      </div>
      {onAlternarVisibilidade && (
        <button
          type="button"
          onClick={onAlternarVisibilidade}
          aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
          className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visivel ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={onCopiar}
        aria-label={`Copiar ${rotulo.toLowerCase()}`}
        className="rounded p-1 text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
