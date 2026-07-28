import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Guarda o JWT no lugar certo por plataforma: keychain/keystore seguro no
 * nativo (expo-secure-store), localStorage no web (SecureStore nao existe no
 * navegador). Assim o app roda tanto em campo quanto em preview/teste web.
 */
export const tokenStore = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // sem storage no web -> sessao apenas em memoria
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async del(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // ignora
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
