import type { DicionarioSensores } from "@isphub/shared";

/**
 * `GET /status-descriptions` da PlataformaTK — capturado da API REAL com a
 * credencial de producao, e podado so nos valores numericos repetitivos (`BAT`
 * lista 1 a 99 um a um; ficaram as bordas das faixas).
 *
 * Fixture de verdade, e nao inventada, porque as regras que ela exercita sao
 * armadilhas que so os dados reais revelam:
 *
 *   - `MOVEMENT` nao documenta `STOPPED`, mas o aparelho responde `UNDEFINED`;
 *   - `CUT` so documenta `ON` — o `OFF` de todo dia nao tem descricao;
 *   - `BAT` tem faixas de 1 a 99, e o rastreador reporta 100;
 *   - `EXTERNAL_BATTERY` vem com `values` VAZIO, so com faixa;
 *   - `COMMUNICATION` usa `True`/`False` e `SUNTECH_INPUT_TWO` usa `true`/`false`.
 *
 * Uma fixture escrita por mim teria as quatro primeiras "certinhas" — e o codigo
 * passaria no teste e falharia no carro.
 */
export const DICIONARIO_PTK: DicionarioSensores = {
  "COMMUNICATION": {
    "type": "LITERAL",
    "name": "INTERNET",
    "icon": "wifi",
    "values": {
      "UP": {
        "summary": "Conectado à internet",
        "severity": "success",
        "description": "Conectado à internet e enviando dados ao nosso servidor com sucesso",
        "icon": null,
        "unit": null
      },
      "DOWN": {
        "summary": "Sem acesso à internet",
        "severity": "danger",
        "description": "Não detectamos comunicação do seu rastreador. Verifique a conexão de internet",
        "icon": null,
        "unit": null
      },
      "True": {
        "summary": "Conectado à internet",
        "severity": "success",
        "description": "Conectado à internet e enviando dados ao nosso servidor com sucesso",
        "icon": null,
        "unit": null
      },
      "False": {
        "summary": "Sem acesso à internet",
        "severity": "danger",
        "description": "Não detectamos comunicação do seu rastreador. Verifique a conexão de internet",
        "icon": null,
        "unit": null
      }
    }
  },
  "TRACKING": {
    "type": "LITERAL",
    "name": "GPS",
    "icon": "globe",
    "values": {
      "ON": {
        "summary": "Com sinal de GPS",
        "severity": "success",
        "description": "As coordendas GPS estão sendo coletadas com sucesso",
        "icon": null,
        "unit": null
      },
      "OFF": {
        "summary": "Sem sinal de GPS",
        "severity": "danger",
        "description": "Este rastreador não está se recebendo sinal dos satélites GPS. Tente ir para um local aberto",
        "icon": null,
        "unit": null
      },
      "True": {
        "summary": "Com sinal de GPS",
        "severity": "success",
        "description": "As coordendas GPS estão sendo coletadas com sucesso",
        "icon": null,
        "unit": null
      },
      "False": {
        "summary": "Sem sinal de GPS",
        "severity": "danger",
        "description": "Este rastreador não está se recebendo sinal dos satélites GPS. Tente ir para um local aberto",
        "icon": null,
        "unit": null
      }
    }
  },
  "MOVEMENT": {
    "type": "LITERAL",
    "name": "MOVIMENTAÇÃO",
    "icon": "road",
    "values": {
      "MOVING": {
        "summary": "Em movimento",
        "severity": "success",
        "description": "Seu rastreador está se movimentando",
        "icon": null,
        "unit": null
      },
      "True": {
        "summary": "Em movimento",
        "severity": "success",
        "description": "Seu rastreador está se movimentando",
        "icon": null,
        "unit": null
      }
    }
  },
  "CONFIGURATION": {
    "type": "LITERAL",
    "name": "CONFIGURAÇÃO",
    "icon": "cog",
    "values": {
      "CONFIGURING": {
        "summary": "Configuração em andamento",
        "severity": "warning",
        "description": "Seu rastreador está sendo configurado pelo sistema. Aguarde",
        "icon": null,
        "unit": null
      },
      "ERROR": {
        "summary": "Tentativa de configuração falhou",
        "severity": "danger",
        "description": "O sistema não conseguiu configurar seu rastreador. Tente novamente ou entre em contato com o suporte",
        "icon": null,
        "unit": null
      },
      "PARTIAL_SUCCESS": {
        "summary": "Rastreador configurado",
        "severity": "warning",
        "description": "A configuração foi concluída com sucesso",
        "icon": null,
        "unit": null
      },
      "SUCCESS": {
        "summary": "Rastreador configurado",
        "severity": "warning",
        "description": "A configuração foi concluída com sucesso",
        "icon": null,
        "unit": null
      }
    }
  },
  "SMS_RESPONSE": {
    "type": "LITERAL",
    "name": "SMS",
    "icon": "envelope",
    "values": {
      "SMS_OK": {
        "summary": "SMS recebido",
        "severity": "success",
        "description": "SMS recebido com SUCESSO pelo destinatário",
        "icon": null,
        "unit": null
      },
      "NOT_DELIVERED": {
        "summary": "SMS não recebido",
        "severity": "danger",
        "description": "SMS NÃO foi recebido pelo destinatário",
        "icon": null,
        "unit": null
      },
      "NOT_RESPONDED": {
        "summary": "SMS não recebido",
        "severity": "danger",
        "description": "SMS NÃO foi recebido pelo destinatário",
        "icon": null,
        "unit": null
      }
    }
  },
  "ACC": {
    "type": "LITERAL",
    "name": "IGNIÇÃO",
    "icon": "power-off",
    "values": {
      "ON": {
        "summary": "Ignição Ligada",
        "severity": "success",
        "description": "Veículo ligado",
        "icon": "toggle-on",
        "unit": null
      },
      "OFF": {
        "summary": "Ignição Desligada",
        "severity": "success",
        "description": "Veículo desligado",
        "icon": "toggle-off",
        "unit": null
      },
      "ANOMALY": {
        "summary": "Ignição com Problemas",
        "severity": "warning",
        "description": "O status de ignição de seu rastreador está com problemas. Verique sua instalação ou entre em contato com o suporte técnico",
        "icon": "exclamation-triangle",
        "unit": null
      },
      "True": {
        "summary": "Ignição Ligada",
        "severity": "success",
        "description": "Veículo ligado",
        "icon": "toggle-on",
        "unit": null
      },
      "False": {
        "summary": "Ignição Desligada",
        "severity": "success",
        "description": "Veículo desligado",
        "icon": "toggle-off",
        "unit": null
      }
    }
  },
  "CUT": {
    "type": "LITERAL",
    "name": "BLOQUEIO",
    "icon": "lock",
    "values": {
      "ON": {
        "summary": "Bloqueado",
        "severity": "danger",
        "description": "Veículo bloqueado",
        "icon": null,
        "unit": null
      },
      "True": {
        "summary": "Bloqueado",
        "severity": "danger",
        "description": "Veículo bloqueado",
        "icon": null,
        "unit": null
      }
    }
  },
  "BAT": {
    "type": "NUMBER",
    "name": "BATERIA",
    "icon": "battery",
    "values": {
      "1": {
        "summary": "1%",
        "severity": "danger",
        "description": null,
        "icon": "battery-0",
        "unit": null
      },
      "14": {
        "summary": "14%",
        "severity": "danger",
        "description": null,
        "icon": "battery-0",
        "unit": null
      },
      "15": {
        "summary": "15%",
        "severity": "danger",
        "description": null,
        "icon": "battery-0",
        "unit": null
      },
      "16": {
        "summary": "16%",
        "severity": "warning",
        "description": null,
        "icon": "battery-1",
        "unit": null
      },
      "35": {
        "summary": "35%",
        "severity": "warning",
        "description": null,
        "icon": "battery-1",
        "unit": null
      },
      "36": {
        "summary": "36%",
        "severity": "success",
        "description": null,
        "icon": "battery-2",
        "unit": null
      },
      "99": {
        "summary": "99%",
        "severity": "success",
        "description": null,
        "icon": "battery-4",
        "unit": null
      }
    },
    "rangesDescriptions": [
      {
        "minValue": 1,
        "maxValue": 15,
        "valueDescription": {
          "summary": null,
          "severity": "danger",
          "description": null,
          "icon": "battery-0",
          "unit": "%"
        }
      },
      {
        "minValue": 16,
        "maxValue": 35,
        "valueDescription": {
          "summary": null,
          "severity": "warning",
          "description": null,
          "icon": "battery-1",
          "unit": "%"
        }
      },
      {
        "minValue": 36,
        "maxValue": 59,
        "valueDescription": {
          "summary": null,
          "severity": "success",
          "description": null,
          "icon": "battery-2",
          "unit": "%"
        }
      },
      {
        "minValue": 60,
        "maxValue": 79,
        "valueDescription": {
          "summary": null,
          "severity": "success",
          "description": null,
          "icon": "battery-3",
          "unit": "%"
        }
      },
      {
        "minValue": 80,
        "maxValue": 99,
        "valueDescription": {
          "summary": null,
          "severity": "success",
          "description": null,
          "icon": "battery-4",
          "unit": "%"
        }
      }
    ]
  },
  "ANCHOR": {
    "type": "LITERAL",
    "name": "ÂNCORA VIRTUAL",
    "icon": "anchor",
    "values": {
      "IN": {
        "summary": "Dentro da âncora virtual",
        "severity": "success",
        "description": "Dentro da âncora virtual",
        "icon": null,
        "unit": null
      },
      "OUT": {
        "summary": "Fora da âncora virtual",
        "severity": "danger",
        "description": "Fora da âncora virtual",
        "icon": null,
        "unit": null
      }
    }
  },
  "SLEEP": {
    "type": "LITERAL",
    "name": "MODO SLEEP",
    "icon": "moon",
    "values": {
      "SLEEP": {
        "summary": "Em modo sleep",
        "severity": "warning",
        "description": "Esse rastreador não está se comunicando pois entrou em modo de economia de energia (sleep).",
        "icon": null,
        "unit": null
      }
    }
  },
  "TEMPERATURE": {
    "type": "NUMBER",
    "name": "TEMPERATURA",
    "icon": "thermometer-full",
    "values": {
      "1": {
        "summary": "1ºC",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "14": {
        "summary": "14ºC",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "15": {
        "summary": "15ºC",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "16": {
        "summary": "16ºC",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "35": {
        "summary": "35ºC",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "36": {
        "summary": "36ºC",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "99": {
        "summary": "99ºC",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      }
    },
    "rangesDescriptions": [
      {
        "minValue": -50,
        "maxValue": 100,
        "valueDescription": {
          "summary": null,
          "severity": "success",
          "description": null,
          "icon": null,
          "unit": "ºC"
        }
      }
    ]
  },
  "HUMIDITY": {
    "type": "NUMBER",
    "name": "UMIDADE",
    "icon": "tint",
    "values": {
      "1": {
        "summary": "1%",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "14": {
        "summary": "14%",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "15": {
        "summary": "15%",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "16": {
        "summary": "16%",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "35": {
        "summary": "35%",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "36": {
        "summary": "36%",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "99": {
        "summary": "99%",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      }
    },
    "rangesDescriptions": [
      {
        "minValue": 0,
        "maxValue": 100,
        "valueDescription": {
          "summary": null,
          "severity": "success",
          "description": null,
          "icon": null,
          "unit": "%"
        }
      }
    ]
  },
  "SUNTECH_INPUT_TWO": {
    "type": "LITERAL",
    "name": "Entrada 2",
    "icon": "circle",
    "values": {
      "true": {
        "summary": "ligada",
        "severity": "success",
        "description": null,
        "icon": null,
        "unit": null
      },
      "false": {
        "summary": "desligada",
        "severity": "danger",
        "description": null,
        "icon": null,
        "unit": null
      }
    }
  },
  "EXTERNAL_BATTERY": {
    "type": "NUMBER",
    "name": "BATERIA EXTERNA",
    "icon": "car-battery",
    "values": {},
    "rangesDescriptions": [
      {
        "minValue": 1,
        "maxValue": 100,
        "valueDescription": {
          "summary": null,
          "severity": "success",
          "description": null,
          "icon": null,
          "unit": "V"
        }
      }
    ]
  }
};
