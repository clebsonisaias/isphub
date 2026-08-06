/**
 * Blob/File -> base64 PURO (sem o prefixo `data:...;base64,`).
 *
 * As rotas de upload da API recebem os bytes ja separados do mime — o mime vai
 * num campo proprio. Mandar a data URL inteira faria o servidor decodificar o
 * cabecalho como se fosse conteudo, e o arquivo gravado nasceria corrompido.
 *
 * Vivia dentro do Composer do chat; virou lib quando o comprovante do
 * financeiro precisou da mesma conversao.
 */
export function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const resultado = reader.result as string;
      resolve(resultado.slice(resultado.indexOf(",") + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
