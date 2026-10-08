import { useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup } from "react-leaflet";
import { AjustarLimites, BRASIL_CENTER, CamadaOsm } from "@/components/mapa/base";
import { ROTULO_TURNO, TURNOS_AGENDA, diaBrHoje, inicioDaSemana, somarDias, type FilaItem, type Provedor, type TurnoAgenda } from "@isphub/shared";
import { agendaApi, rotuloDiaAgenda, type ParadaAgenda } from "@/lib/agendaApi";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { ProvedorBadge } from "@/components/ProvedorBadge";
import { ContratoStatusBadge } from "@/components/ContratoStatusBadge";
import { UserRole } from "@isphub/shared";
import { useAuth } from "@/context/AuthContext";
import { filaApi } from "@/lib/filaApi";
import { provedoresApi } from "@/lib/adminApi";
import { ApiError } from "@/lib/apiClient";
import { contratoTemProblema } from "@/lib/contratoStatus";
import { useToast } from "@/context/ToastContext";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

/**
 * Recorte de equipe do mapa. Os valores sao os que a API entende
 * (`equipe` em GET /fila); os rotulos falam a lingua da operacao — quem usa
 * esta tela pensa em "serviço" e "retirada", nao em "equipe interna/externa".
 */
type EquipeFiltro = "todas" | "interna" | "externa";

const EQUIPE_OPCOES: { valor: EquipeFiltro; rotulo: string }[] = [
  { valor: "todas", rotulo: "Serviços e retiradas" },
  { valor: "interna", rotulo: "Só serviços" },
  { valor: "externa", rotulo: "Só retiradas" },
];

/**
 * Cor do halo de alerta, lida do token do tema (`--destructive`) em vez de um
 * hex fixo — claro e escuro usam valores diferentes, e um vermelho cravado
 * ficaria fora de tom num deles.
 */
function corDeAlerta(): string {
  const valor = getComputedStyle(document.documentElement).getPropertyValue("--destructive").trim();
  // Fallback pro caso do token nao existir (teste isolado, CSS ainda nao aplicado).
  return valor || "#ef4444";
}

/**
 * Pin colorido com a cor do provedor (evita depender dos icones default do
 * Leaflet). Monta o elemento via DOM API (nao interpolando `cor` numa string
 * HTML) para nao depender so da validacao do backend contra a cor conter markup.
 */
function pinIcon(cor: string, retirada = false, contratoIrregular = false, numero?: number) {
  const ponto = document.createElement("span");
  ponto.style.display = "block";
  // Com numero (rota do turno) o pino cresce pra caber a parada; e a ordem de
  // visita, nao um id — e o que o supervisor confere contra o painel da rota.
  const lado = numero != null ? 24 : 16;
  ponto.style.width = `${lado}px`;
  ponto.style.height = `${lado}px`;
  if (numero != null) {
    ponto.textContent = String(numero);
    ponto.style.color = "#fff";
    ponto.style.font = "700 11px/20px system-ui, sans-serif";
    ponto.style.textAlign = "center";
  }
  /*
   * FORMA distingue retirada de serviço da casa: losango (quadrado girado)
   * contra círculo.
   *
   * Não é cor porque a cor do pino já é a identidade do provedor — usá-la
   * também pra tipo de serviço faria os dois significados competirem no mesmo
   * canal, e um mapa com vários provedores viraria adivinhação. Forma é um
   * canal livre, e sobrevive a daltonismo e a sol na tela.
   */
  if (retirada) {
    ponto.style.borderRadius = "2px";
    ponto.style.transform = "rotate(45deg)";
  } else {
    ponto.style.borderRadius = "9999px";
  }
  ponto.style.backgroundColor = cor;
  ponto.style.border = "2px solid white";

  /*
   * HALO = contrato irregular (não-ativo). Terceiro canal, cada um com UM
   * significado: preenchimento = provedor, forma = serviço/retirada, halo =
   * contrato.
   *
   * É halo e não o preenchimento porque, com a regra do projeto de só colorir
   * o problema, pintar o preenchimento deixaria todo pino normal cinza — e a
   * cor do provedor é o único canal panorâmico de identidade que existe (o
   * nome do provedor só aparece dentro do popup). Apagá-la em ~90% dos pinos
   * custaria mais do que o sinal ganharia.
   *
   * `box-shadow` empilhado: o anel primeiro, a sombra de profundidade depois.
   */
  const sombra = "0 1px 4px rgba(0,0,0,.5)";
  ponto.style.boxShadow = contratoIrregular ? `0 0 0 3px ${corDeAlerta()}, ${sombra}` : sombra;

  /*
   * No Leaflet o `iconSize` E a area clicavel. Um pino de 16px e impossivel de
   * acertar com o dedo, mas engordar o PONTO deixaria o mapa ilegivel com
   * dezenas de OS. Entao no toque o icone vira uma caixa de 44px com o mesmo
   * ponto de 16px centrado: alvo do tamanho certo, visual intacto.
   *
   * Em aglomerado os alvos se sobrepoem e o toque pega o pino de cima — e o
   * comportamento normal de mapa, resolvido dando zoom. Melhor do que a
   * alternativa anterior, que era nao acertar pino nenhum.
   */
  const toque = window.matchMedia("(pointer: coarse)").matches;
  if (!toque) {
    return L.divIcon({ className: "", html: ponto, iconSize: [lado, lado], iconAnchor: [lado / 2, lado / 2] });
  }

  const caixa = document.createElement("span");
  caixa.style.display = "flex";
  caixa.style.width = "44px";
  caixa.style.height = "44px";
  caixa.style.alignItems = "center";
  caixa.style.justifyContent = "center";
  caixa.appendChild(ponto);
  return L.divIcon({ className: "", html: caixa, iconSize: [44, 44], iconAnchor: [22, 22] });
}



export function MapaPage() {
  const { usuario } = useAuth();
  const { toast } = useToast();
  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [provedorId, setProvedorId] = useState("");
  /*
   * Recorte de equipe. Vai pro SERVIDOR, nao filtra no cliente: pedir so
   * "externa" reduz o conjunto ANTES do teto do servidor, enquanto esconder
   * pinos aqui deixaria de fora o que ja tinha sido cortado — o mapa mostraria
   * menos do que existe achando que mostrou tudo.
   */
  const [equipe, setEquipe] = useState<EquipeFiltro>("todas");
  const [itens, setItens] = useState<FilaItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  /*
   * ROTA DO TURNO: "" = todas as OS abertas (o mapa de sempre); "dia|turno" =
   * só as visitas marcadas naquela janela, numeradas pela ordem da rota e
   * ligadas por uma linha. E a visao que o teto por regiao tentava proteger
   * sem ninguem conseguir ENXERGAR o deslocamento.
   */
  const [janela, setJanela] = useState("");
  const [paradas, setParadas] = useState<ParadaAgenda[]>([]);
  const hoje = diaBrHoje();
  const janelas = useMemo(() => {
    const segunda = inicioDaSemana(hoje);
    return Array.from({ length: 6 }, (_, i) => somarDias(segunda, i)).flatMap((dia) =>
      TURNOS_AGENDA.filter((t) => !(t === "tarde" && new Date(`${dia}T12:00:00Z`).getUTCDay() === 6)).map((t) => ({
        valor: `${dia}|${t}`,
        rotulo: `${dia === hoje ? "Hoje" : rotuloDiaAgenda(dia)} · ${ROTULO_TURNO[t]}`,
      })),
    );
  }, [hoje]);

  useEffect(() => {
    if (!janela) {
      setParadas([]);
      return;
    }
    const [dia, turno] = janela.split("|") as [string, TurnoAgenda];
    let cancelado = false;
    setCarregando(true);
    agendaApi
      .doTurno(dia, turno)
      .then((p) => !cancelado && setParadas(p))
      .catch((err) => !cancelado && toast({ titulo: "Erro ao carregar a rota", descricao: mensagem(err), variante: "erro" }))
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [janela]);

  useEffect(() => {
    provedoresApi.listar().then(setProvedores).catch(() => {});
  }, []);

  useEffect(() => {
    if (janela) return; // no modo rota, quem carrega e o efeito da janela
    setCarregando(true);
    filaApi
      .listar({
        provedorId: provedorId || undefined,
        /*
         * SÓ AS ABERTAS. O mapa é ferramenta de deslocamento — serve pra
         * decidir aonde ir agora. OS encerrada não tem para onde ir, e antes
         * elas entravam junto: além de sujar a leitura, eram a maior parte do
         * volume (a operação fecha muito mais do que tem aberto), o que
         * estourava o teto do servidor e disparava o aviso de "Mapa parcial"
         * mesmo com poucas OS realmente em campo.
         */
        grupo: "abertos",
        /*
         * Padrão "todas": traz também as de equipe externa (retiradas), que
         * ficavam de fora do mapa por herdar o padrão "interna" do Painel.
         * Elas ocupam rua e agenda como qualquer outra — só são executadas por
         * outra equipe, e é isso que o marcador em losango comunica.
         */
        equipe,
      })
      .then((resp) => {
        const comCoordenadas = resp.itens.filter(
          (i) => i.endereco.lat != null && i.endereco.lng != null,
        );
        setItens(comCoordenadas);
        // Nunca esconder pinos em silencio: se o servidor truncou, avisa pra
        // filtrar por provedor (que reduz o conjunto abaixo do teto).
        if (resp.truncado) {
          toast({
            titulo: "Mapa parcial",
            descricao: "Há mais OS do que o mapa carrega de uma vez. Filtre por um provedor pra ver todas no mapa.",
            variante: "erro",
          });
        }
      })
      .catch((err) => toast({ titulo: "Erro ao carregar o mapa", descricao: mensagem(err), variante: "erro" }))
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provedorId, equipe, janela]);

  /*
   * Quantos contratos irregulares há no recorte. Serve pra dois fins: decidir
   * se a legenda do halo aparece (explicar um sinal que não está na tela é
   * ruído — mesmo critério já usado nas formas) e dar o número, que é a
   * informação que o gestor quer antes de despachar.
   */
  const irregulares = useMemo(
    () => itens.filter((i) => contratoTemProblema(i.contratoStatus)).length,
    [itens],
  );

  // Paradas da rota com coordenada, ja na ordem de visita (doTurno ordena por ordemRota).
  const paradasNoMapa = useMemo(
    () =>
      paradas
        .map((p, i) => ({ parada: p, numero: p.ordemRota ?? i + 1 }))
        .filter(({ parada }) => parada.ordemServico?.lat != null && parada.ordemServico?.lng != null),
    [paradas],
  );
  const semCoordenada = paradas.length - paradasNoMapa.length;

  const pontos = useMemo<[number, number][]>(
    () =>
      janela
        ? paradasNoMapa.map(({ parada }) => [parada.ordemServico!.lat as number, parada.ordemServico!.lng as number])
        : itens.map((i) => [i.endereco.lat as number, i.endereco.lng as number]),
    [itens, janela, paradasNoMapa],
  );

  return (
    <AppShell>
      <AnimatedPage>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Mapa</h1>
          {/* "aberta" explicito: sem isso, o numero parece "todas as OS" e
              quem conhece o volume da operacao acha que sumiu dado. */}
          <p className="text-sm text-muted-foreground">
            {janela
              ? `${paradasNoMapa.length} ${paradasNoMapa.length === 1 ? "parada" : "paradas"} na rota${semCoordenada > 0 ? ` · ${semCoordenada} sem coordenada` : ""}`
              : `${itens.length} ${itens.length === 1 ? "OS aberta geolocalizada" : "OS abertas geolocalizadas"}`}
          </p>
          {/*
            Legenda. Marcador com significado e enigma sem ela — quem olha ve
            um losango e nao tem como deduzir que aquilo e retirada.
          */}
          {/* Só as formas que PODEM aparecer no recorte atual: explicar um
              losango quando o filtro está em "Só serviços" é ruído. */}
          <p className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
            {equipe !== "externa" && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full border border-white bg-muted-foreground" />
                Serviço
              </span>
            )}
            {irregulares > 0 && (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full border border-white bg-muted-foreground ring-[3px] ring-destructive"
                />
                Contrato irregular ({irregulares})
              </span>
            )}
            {equipe !== "interna" && (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rotate-45 rounded-[2px] border border-white bg-muted-foreground"
                />
                Retirada
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={janela}
            onChange={(e) => setJanela(e.target.value)}
            aria-label="Rota de um turno"
            className="bg-secondary/40"
          >
            <option value="">Todas as OS abertas</option>
            {janelas.map((j) => (
              <option key={j.valor} value={j.valor}>
                Rota: {j.rotulo}
              </option>
            ))}
          </Select>
          {!janela && (
          <Select
            value={equipe}
            onChange={(e) => setEquipe(e.target.value as EquipeFiltro)}
            aria-label="Tipo de OS no mapa"
            className="bg-secondary/40"
          >
            {EQUIPE_OPCOES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Select>
          )}
          {!janela && usuario?.role !== UserRole.PROVEDOR && usuario?.role !== UserRole.TECNICO && (
            <Select
              value={provedorId}
              onChange={(e) => setProvedorId(e.target.value)}
              aria-label="Provedor"
              className="bg-secondary/40"
            >
              <option value="">Todos os provedores</option>
              {provedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {carregando ? (
        <Skeleton className="h-[70vh] w-full rounded-xl" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border" style={{ height: "70vh" }}>
          <MapContainer center={BRASIL_CENTER} zoom={4} style={{ height: "100%", width: "100%" }}>
            <CamadaOsm />
            <AjustarLimites pontos={pontos} />
            {janela && pontos.length > 1 ? (
              <Polyline positions={pontos} pathOptions={{ color: "var(--primary)", weight: 3, opacity: 0.7, dashArray: "6 6" }} />
            ) : null}
            {janela &&
              paradasNoMapa.map(({ parada, numero }) => {
                const os = parada.ordemServico!;
                return (
                  <Marker key={parada.id} position={[os.lat as number, os.lng as number]} icon={pinIcon(parada.provedor.cor, false, false, numero)}>
                    <Popup>
                      <div className="flex flex-col gap-1 text-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {numero}ª parada · {ROTULO_TURNO[janela.split("|")[1] as TurnoAgenda]}
                        </p>
                        <p className="font-medium">{os.clienteNome ?? `OS ${parada.sgpOsId}`}</p>
                        {os.tipoOs?.categoria ? (
                          <span className="text-xs font-medium" style={{ color: os.tipoOs.categoria.cor }}>
                            {os.tipoOs.categoria.nome}
                          </span>
                        ) : null}
                        <p className="text-muted-foreground">
                          {[os.logradouro, os.numero].filter(Boolean).join(", ") || os.bairro || os.pop || "Localização não informada"}
                        </p>
                        {os.tecnico ? <p className="text-xs text-muted-foreground">Técnico: {os.tecnico.nomeExibicao ?? os.tecnico.nome}</p> : null}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            {!janela && itens.map((item) => (
              <Marker
                key={item.id}
                position={[item.endereco.lat as number, item.endereco.lng as number]}
                icon={pinIcon(
                  item.provedor.cor,
                  item.categoria?.equipeExterna === true,
                  contratoTemProblema(item.contratoStatus),
                )}
              >
                <Popup>
                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-1">
                      <ProvedorBadge provedor={item.provedor} />
                      <StatusBadge status={item.status} />
                      <ContratoStatusBadge status={item.contratoStatus} />
                    </div>
                    {item.categoria && (
                      <span className="inline-flex w-fit items-center gap-1 text-xs font-medium" style={{ color: item.categoria.cor }}>
                        {item.categoria.nome}
                      </span>
                    )}
                    <p className="font-medium">{item.clienteNome ?? "Cliente não identificado"}</p>
                    <p className="text-muted-foreground">
                      {item.endereco.logradouro
                        ? `${item.endereco.logradouro}, ${item.endereco.numero} — ${item.endereco.bairro}`
                        : item.pop
                          ? `Localização (POP): ${item.pop}`
                          : "Localização não informada"}
                    </p>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}
      </AnimatedPage>
    </AppShell>
  );
}
