import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";

/**
 * Wrappers do desbloqueio biometrico (Face ID / impressao digital). Tudo aqui
 * e FAIL-SAFE: qualquer erro/indisponibilidade cai pra `false` — o login por
 * senha nunca deixa de funcionar, entao biometria nunca tranca o tecnico fora.
 */

export type TipoBiometria = "face" | "digital" | "generico";

export interface BiometriaInfo {
  /** Tem hardware E tem alguma biometria cadastrada no aparelho. */
  disponivel: boolean;
  tipo: TipoBiometria;
}

export async function checarBiometria(): Promise<BiometriaInfo> {
  if (Platform.OS === "web") return { disponivel: false, tipo: "generico" };
  try {
    const [temHardware, cadastrada, tipos] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const face = tipos.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const digital = tipos.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    return { disponivel: temHardware && cadastrada, tipo: face ? "face" : digital ? "digital" : "generico" };
  } catch {
    return { disponivel: false, tipo: "generico" };
  }
}

export async function autenticarBiometria(motivo: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: motivo,
      cancelLabel: "Usar senha",
      // Deixa cair pro PIN/padrao do aparelho se a biometria falhar — nunca
      // deixa o usuario sem saida (ele ainda tem a senha do app tambem).
      disableDeviceFallback: false,
    });
    return r.success;
  } catch {
    return false;
  }
}

export function rotuloBiometria(tipo: TipoBiometria): string {
  return tipo === "face" ? "Face ID" : tipo === "digital" ? "impressão digital" : "biometria";
}

export function iconeBiometria(tipo: TipoBiometria): "smile" | "unlock" {
  // Feather nao tem glifo de digital; "smile" evoca rosto, "unlock" pro resto.
  return tipo === "face" ? "smile" : "unlock";
}
