import { Image } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";

const LADO_AVATAR = 320;
const QUALIDADE_JPEG = 0.7;

function obterDimensoes(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/**
 * Avatar so e exibido pequeno/circular — corta quadrado (centro) e comprime bem
 * mais que o comprimirImagem do chat (1600px/0.6, pensado pra preservar detalhe
 * de evidencia). 320px ja e ~7x o maior avatar renderizado (44px, com retina).
 */
export async function comprimirAvatar(uri: string): Promise<{ base64: string; mime: string }> {
  const { width, height } = await obterDimensoes(uri);
  const lado = Math.min(width, height);
  const originX = Math.round((width - lado) / 2);
  const originY = Math.round((height - lado) / 2);
  const resultado = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop: { originX, originY, width: lado, height: lado } }, { resize: { width: LADO_AVATAR, height: LADO_AVATAR } }],
    { compress: QUALIDADE_JPEG, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!resultado.base64) throw new Error("Não foi possível processar a foto");
  return { base64: resultado.base64, mime: "image/jpeg" };
}
