/**
 * Robô da planilha de agendamento -> ISPhub (Google Apps Script).
 *
 * Roda nos servidores do Google, com a conta de quem já enxerga a planilha:
 * a cada 15 min pega o .xlsx do Drive e manda cru para o ISPhub, que aplica na
 * agenda (ver apps/api/src/services/planilhaSyncService.ts). Não precisa de
 * conta de serviço, de segredo nem do Mac ligado: o script se identifica com o
 * login Google de quem o instalou (ScriptApp.getIdentityToken), e o ISPhub só
 * aceita os e-mails de PLANILHA_SYNC_EMAILS.
 *
 * Instalação (uma vez):
 *  1. script.google.com -> Novo projeto -> cole este arquivo em Código.gs.
 *  2. Configurações do projeto -> marque "Mostrar arquivo de manifesto
 *     appsscript.json no editor" -> no editor, troque o appsscript.json pelo
 *     bloco MANIFESTO abaixo.
 *  3. Configurações do projeto -> Propriedades do script -> adicionar:
 *       FILE_ID     1S4xjdOFJb3xeb3SVgyCbvSO9DlF17huA
 *       ISPHUB_URL  https://api.isphub.net.br/api/planilha/receber
 *  4. No editor, escolha a função `instalar` e clique em Executar; autorize
 *     com a sua conta.
 *  5. Em Execuções, a 1ª rodada mostra a resposta do ISPhub.
 *
 * Para parar (quando a planilha deixar de ser usada): rode `desinstalar`.
 *
 * MANIFESTO (appsscript.json):
 * {
 *   "timeZone": "America/Fortaleza",
 *   "exceptionLogging": "STACKDRIVER",
 *   "runtimeVersion": "V8",
 *   "oauthScopes": [
 *     "https://www.googleapis.com/auth/drive.readonly",
 *     "https://www.googleapis.com/auth/script.external_request",
 *     "https://www.googleapis.com/auth/script.scriptapp",
 *     "openid",
 *     "https://www.googleapis.com/auth/userinfo.email"
 *   ]
 * }
 */

const PROP = PropertiesService.getScriptProperties();

function enviar() {
  const fileId = PROP.getProperty('FILE_ID');
  const url = PROP.getProperty('ISPHUB_URL');
  if (!fileId || !url) {
    throw new Error('Configure FILE_ID e ISPHUB_URL em Propriedades do script.');
  }

  const arquivo = DriveApp.getFileById(fileId);
  const versao = String(arquivo.getLastUpdated().getTime());
  // O ISPhub também ignora arquivo repetido; isto só evita mandar 100 KB à toa.
  if (versao === PROP.getProperty('ULTIMA_VERSAO_OK')) {
    console.log('Planilha sem alteração desde o último envio.');
    return;
  }

  const r = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/octet-stream',
    payload: arquivo.getBlob().getBytes(),
    // Token assinado pelo Google com o e-mail de quem roda o script; vale ~1 h.
    headers: { Authorization: 'Bearer ' + ScriptApp.getIdentityToken() },
    muteHttpExceptions: true,
  });
  const texto = r.getContentText();
  console.log(r.getResponseCode() + ' ' + texto.slice(0, 1500));

  // Só dá a versão por entregue quando o ISPhub aplicou sem erro nem trava;
  // senão a próxima rodada manda de novo.
  if (r.getResponseCode() === 200) {
    const corpo = JSON.parse(texto);
    if (!corpo.erro && !corpo.trava) PROP.setProperty('ULTIMA_VERSAO_OK', versao);
  }
}

function instalar() {
  desinstalar();
  ScriptApp.newTrigger('enviar').timeBased().everyMinutes(15).create();
  enviar();
}

function desinstalar() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'enviar'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
