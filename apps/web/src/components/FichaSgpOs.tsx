import { useEffect, useState } from "react";
import type { OsFichaSgp } from "@isphub/shared";
import { ordensServicoApi } from "@/lib/filaApi";
import { corSinal, rotuloSinal } from "@/lib/sinal";
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
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setFicha(null);
    setEstado("carregando");
    setSenhaVisivel(false);
    ordensServicoApi
      .fichaSgp(ordemServicoId)
      .then((f) => {
        if (cancelado) return;
        setFicha(f);
        setEstado("ok");
      })
      .catch(() => {
        if (!cancelado) setEstado("erro");
      });
    return () => {
      cancelado = true;
    };
  }, [ordemServicoId]);

  if (estado === "carregando") {
    return <Bloco titulo="Ficha do SGP">{<p className="text-sm text-muted-foreground">Consultando o SGP…</p>}</Bloco>;
  }
  if (estado === "erro") {
    return (
      <Bloco titulo="Ficha do SGP">
        <p className="text-sm text-muted-foreground">Não foi possível ler a ficha no SGP do provedor.</p>
      </Bloco>
    );
  }

  async function copiar(rotulo: string, valor: string) {
    await navigator.clipboard.writeText(valor);
    setCopiado(rotulo);
    setTimeout(() => setCopiado(null), 1500);
  }

  // SGP nao conhece esta OS (removida por la). O sync detecta e tira da fila
  // no proximo ciclo; dizer isso aqui evita alguem insistir numa OS fantasma.
  if (!ficha) {
    return (
      <Bloco titulo="Ficha do SGP">
        <p className="text-sm text-muted-foreground">Esta OS não existe mais no SGP do provedor.</p>
      </Bloco>
    );
  }

  const temCliente =
    ficha.clienteNome || ficha.clienteDocumento || ficha.clienteContato || ficha.clienteEmail || ficha.contratoStatus;
  const temPlano = ficha.plano || ficha.planoDownload || ficha.planoUpload;
  const temConexao =
    ficha.servicoOnline !== null ||
    ficha.servicoIp ||
    ficha.servicoMac ||
    ficha.sinalRxDbm !== null ||
    ficha.sinalTxDbm !== null ||
    ficha.oltNome;
  const temPppoe = ficha.servicoLogin || ficha.servicoSenha;
  const temLocal = ficha.enderecoComplemento || ficha.enderecoPontoReferencia;
  const temEquipe = ficha.tecnicoResponsavel || ficha.tecnicosAuxiliares.length > 0 || ficha.setor;
  const temRegistro = ficha.servicoPrestado || ficha.observacao;

  /**
   * SGP respondeu, mas sem nada que interesse. Acontece de verdade — contrato
   * inativo/cancelado nao tem servico ativo, entao nao tem plano nem PPPoE.
   *
   * Antes isto renderizava um `div` vazio: ausencia silenciosa ficava
   * indistinguivel de feature quebrada, e a pergunta virava "cade o PPPoE?".
   * Dizer o motivo custa uma linha e responde sozinho.
   */
  if (!temCliente && !temPlano && !temConexao && !temPppoe && !temLocal && !temEquipe && !temRegistro) {
    return (
      <Bloco titulo="Ficha do SGP">
        <p className="text-sm text-muted-foreground">
          O SGP não retornou cadastro, plano nem acesso PPPoE para esta OS — normal quando o contrato está inativo ou
          cancelado.
        </p>
      </Bloco>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Quem e o assinante. No escritorio isto e o que o atendente usa pra
          confirmar com quem esta falando antes de passar qualquer informacao. */}
      {temCliente && (
        <Bloco titulo="Cliente">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {ficha.clienteNome && <span className="font-semibold text-foreground">{ficha.clienteNome}</span>}
            {ficha.contratoStatus && <Chip>{ficha.contratoStatus}</Chip>}
          </div>
          {ficha.clienteDocumento && <Linha rotulo="CPF/CNPJ" valor={ficha.clienteDocumento} mono />}
          {ficha.clienteContato && (
            <Credencial
              rotulo="Telefone"
              valor={ficha.clienteContato}
              copiado={copiado === "contato"}
              onCopiar={() => void copiar("contato", ficha.clienteContato!)}
            />
          )}
          {ficha.clienteEmail && <Linha rotulo="E-mail" valor={ficha.clienteEmail} />}
        </Bloco>
      )}

      {temPlano && (
        <Bloco titulo="Plano contratado">
          <div className="flex flex-wrap items-center gap-2">
            {ficha.plano && <span className="font-semibold text-foreground">{ficha.plano}</span>}
            {ficha.planoDownload && <Chip>↓ {ficha.planoDownload}</Chip>}
            {ficha.planoUpload && <Chip>↑ {ficha.planoUpload}</Chip>}
          </div>
        </Bloco>
      )}

      {/* Conexao. "ultimo lido" de proposito: o botao "Verificar conexao e
          sinal" logo acima faz uma sonda AO VIVO, e dois valores de dBm sem
          contexto viram duvida ("qual vale?"). Aqui e o registrado; la e agora. */}
      {temConexao && (
        <Bloco titulo="Conexão (último lido)">
          <div className="flex flex-wrap items-center gap-2">
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
            {ficha.sinalRxDbm !== null && (
              <span className={`text-sm font-semibold ${corSinal(ficha.sinalRxDbm)}`}>
                RX {rotuloSinal(ficha.sinalRxDbm)}
              </span>
            )}
            {ficha.sinalTxDbm !== null && (
              <span className="text-sm text-muted-foreground">TX {rotuloSinal(ficha.sinalTxDbm)}</span>
            )}
          </div>
          {(ficha.servicoIp || ficha.servicoMac) && (
            <p className="font-mono text-xs text-muted-foreground">
              {[ficha.servicoIp, ficha.servicoMac].filter(Boolean).join(" · ")}
            </p>
          )}
          {ficha.oltNome && <Linha rotulo="OLT" valor={ficha.oltNome} />}
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

/** `mono` pra valores que sao lidos digito por digito (documento, MAC, OLT). */
function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={mono ? "font-mono text-sm text-foreground" : "text-sm text-foreground"}>{valor}</p>
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
