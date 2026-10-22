/**
 * Robô da planilha de agendamento -> ISPhub (Google Apps Script).
 *
 * Roda nos servidores do Google, com a conta de quem já enxerga a planilha:
 * a cada 15 min pega o .xlsx do Drive e manda cru para o ISPhub, que aplica na
 * agenda (ver apps/api/src/services/planilhaSyncService.ts). Não precisa de
 * conta de serviço nem do Mac ligado.
 *
 * Instalação (uma vez):
 *  1. script.google.com -> Novo projeto -> apague o conteúdo e cole este arquivo.
 *  2. Configurações do projeto (engrenagem) -> Propriedades do script -> adicionar:
 *       FILE_ID       1S4xjdOFJb3xeb3SVgyCbvSO9DlF17huA
 *       ISPHUB_URL    https://api.isphub.net.br/api/planilha/receber
 *       ISPHUB_TOKEN  (o valor de PLANILHA_SYNC_TOKEN no Coolify, app isphub-api)
 *  3. No editor, escolha a função `instalar` e clique em Executar. Autorize com
 *     a sua conta (ler o Drive e acessar serviço externo).
 *  4. Em Execuções, a 1ª rodada mostra a resposta do ISPhub.
 *
 * Para parar (quando a planilha deixar de ser usada): rode `desinstalar`.
 */

const PROP = PropertiesService.getScriptProperties();

function enviar() {
  const fileId = PROP.getProperty('FILE_ID');
  const url = PROP.getProperty('ISPHUB_URL');
  const token = PROP.getProperty('ISPHUB_TOKEN');
  if (!fileId || !url || !token) {
    throw new Error('Configure FILE_ID, ISPHUB_URL e ISPHUB_TOKEN em Propriedades do script.');
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
    headers: { Authorization: 'Bearer ' + token },
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
