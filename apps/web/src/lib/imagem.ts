const LADO_MAXIMO = 1600;
const QUALIDADE_JPEG = 0.75;

/** Resultado pronto pra mandar em POST /ordens-servico/:id/evidencias. */
export interface ImagemComprimida {
  dados: string;
  mimeType: "image/jpeg";
}

/**
 * Comprime uma foto no navegador antes do upload: redimensiona pro maior
 * lado ficar em ate 1600px e reexporta como JPEG qualidade 0.75. Evita
 * mandar fotos de celular de varios MB — com isso o upload cabe folgado no
 * limite de body JSON de 5mb ja configurado na API, sem precisar de multer
 * nem mudar esse limite.
 */
export async function comprimirImagem(arquivo: File): Promise<ImagemComprimida> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Nao foi possivel processar a imagem neste navegador");
  ctx.drawImage(bitmap, 0, 0, largura, altura);

  const dataUrl = canvas.toDataURL("image/jpeg", QUALIDADE_JPEG);
  const dados = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { dados, mimeType: "image/jpeg" };
}
