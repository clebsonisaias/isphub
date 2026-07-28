import { Image } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

const LADO_MAXIMO = 1600;
const QUALIDADE_JPEG = 0.6;

function obterDimensoes(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/** Mesma ideia do comprimirImagem do web (lado maior <=1600px, JPEG 0.6) — cabe no limite de 400KB do servidor. */
export async function comprimirImagem(uri: string): Promise<{ base64: string; mime: string }> {
  const { width, height } = await obterDimensoes(uri);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(width, height));
  const acoes = escala < 1 ? [{ resize: { width: Math.round(width * escala), height: Math.round(height * escala) } }] : [];
  const resultado = await ImageManipulator.manipulateAsync(uri, acoes, {
    compress: QUALIDADE_JPEG,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  if (!resultado.base64) throw new Error("Não foi possível processar a imagem");
  return { base64: resultado.base64, mime: "image/jpeg" };
}

/** Camera ou galeria — devolve a uri crua (ainda sem compressao) ou null se cancelado/sem permissao. */
export async function escolherFoto(fonte: "camera" | "galeria"): Promise<string | null> {
  const permissao = fonte === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permissao.granted) return null;

  const resultado =
    fonte === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });

  if (resultado.canceled || !resultado.assets[0]) return null;
  return resultado.assets[0].uri;
}

export async function obterLocalizacaoAtual(): Promise<{ lat: number; lng: number } | null> {
  const permissao = await Location.requestForegroundPermissionsAsync();
  if (!permissao.granted) return null;
  const posicao = await Location.getCurrentPositionAsync({});
  return { lat: posicao.coords.latitude, lng: posicao.coords.longitude };
}
