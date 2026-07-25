import type { ErpConnector } from "@isphub/shared";
import { decrypt } from "../lib/crypto.js";
import { createSgpConnector } from "../connectors/sgp.js";

interface ErpConfigRow {
  tipo: string;
  url: string;
  app: string;
  tokenCifrado: string;
}

/**
 * Constroi o conector correto a partir de uma linha de erp_configs,
 * decifrando o token apenas em memoria, no momento do uso. Ponto unico de
 * extensao para novos ERPs (o resto do sistema so conhece ErpConnector).
 */
export function buildConnector(config: ErpConfigRow): ErpConnector {
  const token = decrypt(config.tokenCifrado);
  const creds = { url: config.url, app: config.app, token };

  switch (config.tipo) {
    case "SGP":
      return createSgpConnector(creds);
    default:
      throw new Error(`Tipo de ERP nao suportado: ${config.tipo}`);
  }
}
