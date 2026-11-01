# ISPhub nas lojas — ficha, privacidade e revisão

App único: **ISPhub**, publicado como **atualização do "CITmax Equipe"** (sem uso,
transformado em 01/11/2026): `br.com.citmax.equipe`, App Store ID `6781145807`, mesma
ficha no Play. Projeto EAS `@clebsonisaias/citmax-equipe` (herda certificado, keystore
e contadores do Equipe). Versão 3.0.0 — acima da 2.9.0 do Equipe; versionCode do
Android começou em 71 (Play estava no 69).

O ID `br.net.isphub.app` chegou a ser registrado no portal da Apple e ficou sem uso.
O projeto EAS antigo `isphub-tecnico` segue só para o APK interno dos técnicos.

## Textos da ficha (pt-BR)

**Nome:** ISPhub

**Subtítulo (Apple, até 30):** Campo, vendas e despacho

**Descrição curta (Google, até 80):**
Ordens de serviço, vendas em campo e despacho para provedores de internet.

**Texto promocional (Apple, até 170):**
O dia a dia do provedor de internet no celular: o técnico atende as OS, o
vendedor cadastra e agenda a instalação na hora, a supervisão acompanha tudo.

**Descrição completa:**

O ISPhub é a ferramenta de trabalho das equipes de campo dos provedores de
internet. Cada pessoa entra com o login que a empresa criou e vê a tela do
seu trabalho.

Técnico
- Ordens de serviço do dia, com endereço, rota e contato do cliente
- Fotos de evidência, mesmo sem sinal (sobem quando a internet volta)
- Encerramento da OS em campo e chat com a equipe

Vendedor
- Confere a cobertura no endereço do cliente pelo GPS
- Faz o pré-cadastro com plano e vencimento, direto no sistema do provedor
- Agenda a instalação na hora, com as datas livres da equipe
- Acompanha a própria produção do mês, com meta e conquistas

Supervisão e atendimento
- Despacho das OS para os técnicos, agenda de visitas e mapa
- Chat interno e conversas com o cliente pelo WhatsApp oficial do provedor

O acesso é liberado pelo provedor ou pela empresa responsável pelo serviço.

**Palavras-chave (Apple, até 100):**
provedor,internet,ordem de serviço,técnico,campo,vendas,instalação,agenda,despacho,fibra

**Categoria:** Negócios (secundária: Produtividade)
**Classificação etária:** 4+ / Livre (sem conteúdo gerado por terceiros visível ao público)

## Privacidade (respostas para "Privacidade do app" da Apple e "Segurança dos dados" do Google)

Dados coletados — todos ligados à conta do profissional, nenhum usado para
rastreamento ou publicidade:

| Dado | Para quê | Obrigatório |
|---|---|---|
| Nome, e-mail, telefone do profissional | Conta e contato da equipe | Sim |
| Localização precisa (em uso) | Cobertura no endereço do cliente, rota do dia, check-in na OS | Não (dá para usar CEP) |
| Fotos | Evidência da OS, foto do perfil, anexos do chat | Não |
| Áudio | Mensagem de voz no chat interno | Não |
| Conteúdo de mensagens | Chat interno e com o cliente | Não |
| Dados de clientes do provedor (nome, CPF, endereço, telefone) | Pré-cadastro e atendimento, enviados ao sistema do provedor | Sim (para vender) |
| Identificador do aparelho para notificação | Avisos de OS e mensagens | Não |

- Dados trafegam criptografados (HTTPS). Não são vendidos nem compartilhados
  com terceiros para publicidade.
- Exclusão: o provedor/empresa desativa o acesso; pedidos de exclusão pelo
  e-mail de contato da política de privacidade.

**Política de privacidade:** https://painel.isphub.net.br/privacidade
(`apps/web/src/pages/PrivacidadePage.tsx`). Empresa: Pinheiro Lucena Tecnologia Ltda.,
nome fantasia ISPhub, CNPJ 52.152.454/0001-81, Macaíba/RN. Contato: telefone do CNPJ —
falta um e-mail de privacidade.

## Notas para a revisão da Apple

O app é de uso corporativo: as contas são criadas pelo provedor/empresa, não
há cadastro aberto ao público. Para revisar, use a conta de demonstração
abaixo (provedor fictício, dados fictícios).

O app usa recursos nativos do aparelho: telas nativas do técnico com trabalho
offline e fila de envio de fotos, notificações, Face ID/biometria para entrar,
localização e câmera. Para os perfis de escritório (vendedor, supervisão), o
app abre o painel de gestão da própria empresa, já autenticado.

## Conta de demonstração (criar em produção — tarefa do dono da conta)

1. Provedor **"Provedor Demonstração"** (sem SGP real ligado, ou ligado a um SGP de teste).
2. Usuários (senha forte, anotada só no App Store Connect / Play Console):
   - `revisao.tecnico@isphub.net.br` — papel Técnico, com 2–3 OS fictícias abertas;
   - `revisao.vendedor@isphub.net.br` — papel Vendedor, provedor Demonstração.
3. Na ficha da Apple: "Informações de login" com o técnico; nas notas, o vendedor.

## Build e envio

```bash
# APK de teste (instalar direto no celular)
npx eas-cli build -p android --profile preview

# Lojas
npx eas-cli build -p android --profile production   # AAB para o Play Console
# iOS usa a chave de API da CITmax (sem senha); exporte antes:
# EXPO_ASC_API_KEY_PATH=~/.citmax-ios/AuthKey_Q8435H2NB4.p8 EXPO_ASC_KEY_ID=Q8435H2NB4
# EXPO_ASC_ISSUER_ID=dd5df56b-440c-4143-ae03-d8ed0eaaec21 EXPO_APPLE_TEAM_ID=N65RQHG95F
# EXPO_APPLE_TEAM_TYPE=COMPANY_OR_ORGANIZATION
npx eas-cli build -p ios --profile production        # push: responder "No" (chave APNs exige login com senha)
npx eas-cli submit -p ios --profile production --latest
```

Como o app já existe no Play (é o Equipe), não precisa subir o primeiro AAB à mão:
`eas submit -p android --profile production --latest` usa a conta de serviço da CITmax
(trilha internal, rascunho).

Notificações em produção dependem do `google-services.json` (Firebase) e da
chave APNs (.p8) — ver `docs/push-notificacoes.md` (na raiz do repositório).
