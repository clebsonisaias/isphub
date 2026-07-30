import { useEffect, useState } from "react";
import type { OsFichaSgp } from "@isphub/shared";
import { ordensServicoApi } from "@/lib/filaApi";
import { corSinal, rotuloSinal } from "@/lib/sinal";
import { Eye, EyeOff, Copy, Check, MapPin } from "lucide-react";

export type EstadoFicha = "carregando" | "ok" | "erro";

/**
 * Le a ficha da OS ao vivo no SGP.
 *
 * Hook separado do render porque a ficha alimenta DUAS abas do detalhe da OS
 * (Detalhes e Conexao). Se cada aba montasse seu proprio componente com seu
 * proprio fetch, seriam duas consultas ao ERP do provedor e uma nova a cada
 * troca de aba — o Radix desmonta o conteudo da aba inativa. Buscando uma vez
 * no dialog, trocar de aba nao custa nada.
 */
export function useFichaSgp(ordemServicoId: string) {
  const [ficha, setFicha] = useState<OsFichaSgp | null>(null);
  const [estado, setEstado] = useState<EstadoFicha>("carregando");

  useEffect(() => {
    let cancelado = false;
    setFicha(null);
    setEstado("carregando");
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

  return { ficha, estado };
}

type Props = { ficha: OsFichaSgp | null; estado: EstadoFicha };

/**
 * Estados em que nao ha o que renderizar. Devolve `null` quando ha ficha —
 * quem chama segue pro conteudo. Centralizado pras duas secoes dizerem a mesma
 * coisa: dois textos diferentes pro mesmo estado confundiriam mais que ajudar.
 */
function EstadoVazio({ estado, ficha, titulo }: Props & { titulo: string }) {
  if (estado === "carregando") {
    return (
      <Bloco titulo={titulo}>
        <p className="text-sm text-muted-foreground">Consultando o SGP…</p>
      </Bloco>
    );
  }
  if (estado === "erro") {
    return (
      <Bloco titulo={titulo}>
        <p className="text-sm text-muted-foreground">Não foi possível ler a ficha no SGP do provedor.</p>
      </Bloco>
    );
  }
  /*
   * O SGP nao devolveu NENHUMA das duas fontes (a OS e o cadastro do contrato).
   *
   * Antes isto afirmava "esta OS nao existe mais no SGP" — o dado nao sustenta
   * essa conclusao. Vazio aqui pode ser OS encerrada, endpoint de OS nao
   * liberado na integracao do provedor, ou envelope diferente. Ausencia de
   * verdade quem prova e a deteccao de removidas do sync, que marca a OS como
   * cancelada e registra no historico.
   */
  if (!ficha) {
    return (
      <Bloco titulo={titulo}>
        <p className="text-sm text-muted-foreground">
          O SGP não devolveu dados desta OS. Se ela foi removida por lá, o histórico registra.
        </p>
      </Bloco>
    );
  }
  return null;
}

/**
 * Parte da ficha que responde "quem e o cliente e onde e" — vive na aba
 * Detalhes, junto do resto da identificacao da OS.
 */
export function FichaSgpIdentificacao({ ficha, estado }: Props) {
  const vazio = EstadoVazio({ ficha, estado, titulo: "Ficha do SGP" });
  if (vazio) return vazio;
  const f = ficha!;

  const temCliente = f.clienteNome || f.clienteDocumento || f.clienteContato || f.clienteEmail || f.contratoStatus;
  const temLocal = f.enderecoComplemento || f.enderecoPontoReferencia;
  const temEquipe = f.tecnicoResponsavel || f.tecnicosAuxiliares.length > 0 || f.setor;
  const temRegistro = f.servicoPrestado || f.observacao;

  if (!temCliente && !temLocal && !temEquipe && !temRegistro) {
    return (
      <Bloco titulo="Ficha do SGP">
        <p className="text-sm text-muted-foreground">
          O SGP não retornou cadastro para esta OS — normal quando o contrato está inativo ou cancelado. Os dados de
          conexão ficam na aba <strong className="font-medium text-foreground">Conexão</strong>.
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
            {f.clienteNome && <span className="font-semibold text-foreground">{f.clienteNome}</span>}
            {f.contratoStatus && <Chip>{f.contratoStatus}</Chip>}
          </div>
          {f.clienteDocumento && <Linha rotulo="CPF/CNPJ" valor={f.clienteDocumento} mono />}
          {f.clienteContato && <Linha rotulo="Telefone" valor={f.clienteContato} mono />}
          {f.clienteEmail && <Linha rotulo="E-mail" valor={f.clienteEmail} />}
        </Bloco>
      )}

      {temLocal && (
        <Bloco titulo="Como chegar">
          {f.enderecoComplemento && <p className="text-sm text-foreground">{f.enderecoComplemento}</p>}
          {f.enderecoPontoReferencia && (
            <p className="flex items-start gap-1.5 text-sm text-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>{f.enderecoPontoReferencia}</span>
            </p>
          )}
        </Bloco>
      )}

      {temRegistro && (
        <Bloco titulo="Registrado na OS">
          {f.servicoPrestado && <Linha rotulo="Serviço prestado" valor={f.servicoPrestado} />}
          {f.observacao && <Linha rotulo="Observação" valor={f.observacao} />}
        </Bloco>
      )}

      {temEquipe && (
        <Bloco titulo="Equipe e setor">
          {f.tecnicoResponsavel && <Linha rotulo="Responsável" valor={f.tecnicoResponsavel} />}
          {f.tecnicosAuxiliares.length > 0 && <Linha rotulo="Apoio" valor={f.tecnicosAuxiliares.join(", ")} />}
          {f.setor && <Linha rotulo="Setor" valor={f.setor} />}
        </Bloco>
      )}
    </div>
  );
}

/**
 * Aba Conexao: tudo que descreve o SERVICO do contrato — plano, estado da
 * conexao, sinal optico, OLT e o acesso PPPoE.
 *
 * Junto num lugar so porque e assim que se usa: o atendente abre esta aba pra
 * diagnosticar ou pra ditar o PPPoE pro tecnico no telefone. Espalhados entre
 * o cabecalho e o meio dos Detalhes, obrigavam a caçar.
 */
export function FichaSgpConexao({ ficha, estado }: Props) {
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(rotulo: string, valor: string) {
    await navigator.clipboard.writeText(valor);
    setCopiado(rotulo);
    setTimeout(() => setCopiado(null), 1500);
  }

  const vazio = EstadoVazio({ ficha, estado, titulo: "Conexão" });
  if (vazio) return vazio;
  const f = ficha!;

  const temPlano = f.plano || f.planoDownload || f.planoUpload;
  const temConexao =
    f.servicoOnline !== null || f.servicoIp || f.servicoMac || f.sinalRxDbm !== null || f.sinalTxDbm !== null || f.oltNome;
  const temPppoe = f.servicoLogin || f.servicoSenha;

  if (!temPlano && !temConexao && !temPppoe) {
    return (
      <Bloco titulo="Conexão">
        <p className="text-sm text-muted-foreground">
          O SGP não retornou plano nem acesso PPPoE para este contrato — normal quando ele está inativo ou cancelado.
        </p>
      </Bloco>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {temPlano && (
        <Bloco titulo="Plano contratado">
          <div className="flex flex-wrap items-center gap-2">
            {f.plano && <span className="font-semibold text-foreground">{f.plano}</span>}
            {f.planoDownload && <Chip>↓ {f.planoDownload}</Chip>}
            {f.planoUpload && <Chip>↑ {f.planoUpload}</Chip>}
          </div>
        </Bloco>
      )}

      {/* "ultimo lido" de proposito: o botao "Verificar conexao e sinal" logo
          acima faz uma sonda AO VIVO, e dois valores de dBm sem contexto viram
          duvida ("qual vale?"). Aqui e o registrado; la e agora. */}
      {temConexao && (
        <Bloco titulo="Estado da conexão (último lido)">
          <div className="flex flex-wrap items-center gap-2">
            {/* Verde/vermelho aqui e semantico de verdade: e o servico do cliente. */}
            {f.servicoOnline !== null && (
              <span
                className={
                  f.servicoOnline
                    ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600"
                    : "rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600"
                }
              >
                {f.servicoOnline ? "Online" : "Offline"}
              </span>
            )}
            {f.sinalRxDbm !== null && (
              <span className={`text-sm font-semibold ${corSinal(f.sinalRxDbm)}`}>RX {rotuloSinal(f.sinalRxDbm)}</span>
            )}
            {f.sinalTxDbm !== null && <span className="text-sm text-muted-foreground">TX {rotuloSinal(f.sinalTxDbm)}</span>}
          </div>
          {f.servicoIp && <Linha rotulo="IP" valor={f.servicoIp} mono />}
          {f.servicoMac && <Linha rotulo="MAC" valor={f.servicoMac} mono />}
          {f.oltNome && <Linha rotulo="OLT" valor={f.oltNome} />}
        </Bloco>
      )}

      {temPppoe && (
        <Bloco titulo="Acesso PPPoE">
          <div className="flex flex-col gap-2">
            {f.servicoLogin && (
              <Credencial
                rotulo="Login"
                valor={f.servicoLogin}
                copiado={copiado === "login"}
                onCopiar={() => void copiar("login", f.servicoLogin!)}
              />
            )}
            {f.servicoSenha && (
              <Credencial
                rotulo="Senha"
                valor={senhaVisivel ? f.servicoSenha : "•".repeat(Math.min(f.servicoSenha.length, 12))}
                copiado={copiado === "senha"}
                onCopiar={() => void copiar("senha", f.servicoSenha!)}
                onAlternarVisibilidade={() => setSenhaVisivel((v) => !v)}
                visivel={senhaVisivel}
              />
            )}
          </div>
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
          className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          {visivel ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={onCopiar}
        aria-label={`Copiar ${rotulo.toLowerCase()}`}
        className="rounded p-1 text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
