# API de agendamento (sistemas parceiros)

Permite que um sistema do provedor (ERP, CRM, bot) consulte as vagas da agenda de
visitas da ISPhub e marque a visita de uma OS. O AtendAI usa esta mesma API.

Base: `https://api.isphub.net.br/api/parceiro/v1/agenda`
Especificação completa: `docs/openapi.yaml`, tag **API de agendamento**.

## Autenticação

```
Authorization: Bearer isk_...
```

A chave é gerada no painel, em **Provedores → (provedor) → API de agendamento**.
Aparece uma única vez; o servidor guarda só o hash. Regerar invalida a anterior
na hora. Cada chave pertence a um provedor e só enxerga as OS dele: `provedorId`
no corpo é ignorado. Limite de 120 requisições por minuto por IP.

## Regras que o servidor aplica

Quem chama não precisa reimplementar nada disso, só tratar o 409:

| Regra | Como aparece |
|---|---|
| 15 visitas por turno (manhã 8h–12h, tarde 13h–17h), 30 por dia | janela some de `GET /vagas`; `POST /marcar` responde 409 "Turno lotado" |
| Sábado só de manhã | tarde de sábado nunca é oferecida; 409 "Sabado so tem atendimento de manha" |
| Domingo e feriados nacionais | não oferecidos; 409 "Nao ha atendimento neste dia" |
| Feriados municipais e mutirões | cadastrados pelo supervisor em Agenda → Exceções |
| Antecedência mínima (2h) | a manhã de hoje some depois das 6h |
| Teto por região | com `regiao` informada, um bairro cheio recusa mesmo com vaga no turno |

## Endpoints

| Método | Caminho | Uso |
|---|---|---|
| GET | `/vagas?regiao=&quantas=6` | próximas janelas que cabem |
| POST | `/marcar` | marca ou remarca a visita de uma OS |
| GET | `/marcacao/{sgpOsId}` | o que está marcado para a OS (ou `null`) |
| DELETE | `/marcacao/{sgpOsId}` | desmarca |
| POST | `/marcacao/{sgpOsId}/confirmar` | cliente confirmou |
| POST | `/marcacao/{sgpOsId}/remarcar` | cliente remarcou sozinho (conta no teto de 2) |
| GET | `/visitas?dia=AAAA-MM-DD` | visitas do dia, para lembrete |

## Exemplo

```bash
curl -H "Authorization: Bearer isk_..." \
  "https://api.isphub.net.br/api/parceiro/v1/agenda/vagas?regiao=Macaíba&quantas=4"
```

```json
{ "vagas": [
  { "dia": "2026-10-09", "turno": "tarde", "livres": 7, "inicioEm": "2026-10-09T16:00:00.000Z" },
  { "dia": "2026-10-10", "turno": "manha", "livres": 15, "inicioEm": "2026-10-10T11:00:00.000Z" },
  { "dia": "2026-10-13", "turno": "manha", "livres": 15, "inicioEm": "2026-10-13T11:00:00.000Z" },
  { "dia": "2026-10-13", "turno": "tarde", "livres": 15, "inicioEm": "2026-10-13T16:00:00.000Z" }
] }
```

Repare: 10/10 é sábado e só a manhã aparece; 11/10 é domingo e 12/10 é feriado
nacional, então nenhum dos dois entra.

```bash
curl -X POST -H "Authorization: Bearer isk_..." -H "Content-Type: application/json" \
  -d '{"sgpOsId":"12345","dia":"2026-10-10","turno":"manha","regiao":"Macaíba","marcadoPor":"Maria"}' \
  https://api.isphub.net.br/api/parceiro/v1/agenda/marcar
```

`201` → `{ "id": "...", "dia": "2026-10-10", "turno": "manha", "inicioEm": "..." }`
`409` → `{ "error": "Turno lotado — escolha outro dia ou turno." }` (ofereça outra vaga)

A OS não precisa existir ainda no espelho da ISPhub: marque no mesmo instante em
que a abrir no SGP. A data é gravada no SGP pela ISPhub logo após a resposta.
