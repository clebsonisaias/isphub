import L from "leaflet";

/**
 * Pino de VEICULO.
 *
 * Construido por API de DOM, nunca por string de HTML — a mesma razao que o
 * `pinIcon` da fila documenta: a cor vem do provedor, e concatenar isso num
 * `innerHTML` e injecao esperando acontecer.
 *
 * Um significado por canal visual, pra a leitura nao depender so de cor:
 *
 *   forma       quadrado arredondado  — distingue de OS (circulo) e de retirada
 *                                       (losango). Um pino de frota nunca deve
 *                                       ser confundido com um de OS no mesmo mapa.
 *   preenchido  cor do provedor       — de quem e o carro (neutro = da operacao)
 *   halo        posicao velha/offline — o carro pode nao estar mais ali
 *   pulso       em movimento          — anda agora
 *
 * NAO ha rotacao por direcao: o contrato do fornecedor nao traz heading, e
 * derivar de dois pontos consecutivos aponta pro lado errado sempre que o carro
 * esta parado — que e a maior parte do tempo.
 */
export function veiculoIcon(opts: { cor: string; velha: boolean; movendo: boolean }): L.DivIcon {
  const caixa = document.createElement("div");
  // 44px de area de toque em volta de um marcador de 18px: o alvo do dedo nao
  // pode ser do tamanho do desenho.
  caixa.style.width = "44px";
  caixa.style.height = "44px";
  caixa.style.display = "flex";
  caixa.style.alignItems = "center";
  caixa.style.justifyContent = "center";

  const marca = document.createElement("div");
  marca.style.width = "18px";
  marca.style.height = "18px";
  marca.style.borderRadius = "5px";
  marca.style.background = opts.cor;
  marca.style.border = "2px solid rgba(255,255,255,.9)";
  marca.style.boxShadow = opts.velha
    ? "0 0 0 3px rgba(148,163,184,.55)" // halo cinza: nao confie na posicao
    : opts.movendo
      ? "0 0 0 3px rgba(34,197,94,.45)" // halo verde: andando
      : "0 1px 4px rgba(0,0,0,.45)";
  if (opts.velha) marca.style.opacity = "0.55";

  caixa.appendChild(marca);
  return L.divIcon({ className: "", html: caixa, iconSize: [44, 44], iconAnchor: [22, 22] });
}
