/**
 * Robô da planilha de agendamento -> ISPhub (Google Apps Script).
 *
 * Roda 24/7 nos servidores do Google com a conta de quem enxerga a planilha:
 * a cada 10 min pega o .xlsx do Drive e envia para o ISPhub (POST /api/planilha/receber).
 * Não depende do Mac estar ligado.
 *
 * Link do projeto no Google Apps Script:
 * https://script.google.com/d/1WapXVTnhAlhKgL5NtZwzqXOJpwo9makhHH_cGJPwu7G9nxwrqRhLrIXq/edit
 *
 * Configurações (em Propriedades do script):
 *   FILE_ID     1S4xjdOFJb3xeb3SVgyCbvSO9DlF17huA
 *   ISPHUB_URL  https://api.isphub.net.br/api/planilha/receber
 *   TOKEN       b5f3bdcd050371f8aaf1de1fb8d0f761177320226e91f222ea9175766d7f4f97
 *
 * Para ativar/atualizar:
 *   Selecione a função `instalar` e clique em Executar.
 */

const PROP = PropertiesService.getScriptProperties();

const CONFIG_PADRAO = {
  FILE_ID: '1S4xjdOFJb3xeb3SVgyCbvSO9DlF17huA',
  ISPHUB_URL: 'https://api.isphub.net.br/api/planilha/receber',
  TOKEN: 'b5f3bdcd050371f8aaf1de1fb8d0f761177320226e91f222ea9175766d7f4f97',
};

function obterProp(chave) {
  return PROP.getProperty(chave) || CONFIG_PADRAO[chave];
}

function enviar() {
  const fileId = obterProp('FILE_ID');
  const url = obterProp('ISPHUB_URL');
  const token = obterProp('TOKEN');

  const arquivo = DriveApp.getFileById(fileId);
  const versao = String(arquivo.getLastUpdated().getTime());

  if (versao === PROP.getProperty('ULTIMA_VERSAO_OK')) {
    console.log('Planilha sem alteração desde o último envio.');
    return;
  }

  // Suporta tanto arquivo .xlsx cru do Drive quanto planilha convertida em Google Sheets
  let bytes;
  if (arquivo.getMimeType() === MimeType.GOOGLE_SHEETS) {
    const exportUrl = 'https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=xlsx';
    const resExport = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    bytes = resExport.getBlob().getBytes();
  } else {
    bytes = arquivo.getBlob().getBytes();
  }

  // Usa o TOKEN fixo do servidor ou a identidade Google da conta
  const authHeader = token ? ('Bearer ' + token) : ('Bearer ' + ScriptApp.getIdentityToken());

  const r = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/octet-stream',
    payload: bytes,
    headers: { Authorization: authHeader },
    muteHttpExceptions: true,
  });

  const statusCode = r.getResponseCode();
  const texto = r.getContentText();
  console.log('ISPhub status ' + statusCode + ': ' + texto.slice(0, 1500));

  if (statusCode === 200) {
    const corpo = JSON.parse(texto);
    if (!corpo.erro && !corpo.trava) {
      PROP.setProperty('ULTIMA_VERSAO_OK', versao);
      console.log('Sincronização concluída com sucesso!');
    } else {
      console.warn('ISPhub retornou aviso/erro:', texto);
    }
  } else {
    console.error('Falha no envio para o ISPhub (HTTP ' + statusCode + ')');
  }
}

function instalar() {
  desinstalar();
  // Acionador a cada 10 minutos
  ScriptApp.newTrigger('enviar').timeBased().everyMinutes(10).create();
  console.log('Acionador de 10 em 10 minutos criado com sucesso.');
  enviar();
}

function desinstalar() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'enviar'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  console.log('Acionadores anteriores removidos.');
}
