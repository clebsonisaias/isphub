import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { baixarAnexoAutenticado } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, font, radius } from "@/theme/tokens";
import { iniciais } from "./format";

const TAMANHOS = { sm: 28, md: 36, lg: 44 } as const;

/**
 * Resolve a URI local (cacheada) da foto de um usuario, ou null se ele nao tem
 * foto. `fotoVersao` entra na URL (?v=) pra virar chave de cache nova a cada
 * troca de foto — sem isso o cache-por-arquivo de baixarAnexoAutenticado
 * guardaria a foto antiga pra sempre (ela e imutavel so pros anexos de chat).
 */
export function useAvatarUri(usuarioId: string | undefined, temFoto: boolean | undefined, fotoVersao: number | undefined): string | null {
  const { token } = useAuth();
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    if (!usuarioId || !temFoto) {
      setUri(null);
      return;
    }
    baixarAnexoAutenticado(`/auth/foto/${usuarioId}?v=${fotoVersao ?? 0}`, token)
      .then((local) => vivo && setUri(local))
      .catch(() => vivo && setUri(null));
    return () => {
      vivo = false;
    };
  }, [usuarioId, temFoto, fotoVersao, token]);

  return uri;
}

/** Avatar circular — foto real quando disponivel, senao iniciais (mesma ideia do Avatar.tsx do web). */
export function Avatar({
  nome,
  size = "md",
  online,
  fotoUri,
}: {
  nome: string;
  size?: keyof typeof TAMANHOS;
  online?: boolean;
  fotoUri?: string | null;
}) {
  const px = TAMANHOS[size];
  return (
    <View style={{ width: px, height: px }}>
      {fotoUri ? (
        <Image source={{ uri: fotoUri }} style={[styles.circulo, { width: px, height: px, borderRadius: px / 2 }]} />
      ) : (
        <View style={[styles.circulo, { width: px, height: px, borderRadius: px / 2 }]}>
          <Text style={[styles.letras, { fontSize: px * 0.4 }]}>{iniciais(nome)}</Text>
        </View>
      )}
      {online !== undefined && (
        <View
          style={[
            styles.status,
            { backgroundColor: online ? colors.slaGreen : colors.muted, right: -1, bottom: -1 },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circulo: {
    backgroundColor: colors.brandBg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  letras: { fontWeight: font.weight.bold as "700", color: colors.brandInk },
  status: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.card,
  },
});
