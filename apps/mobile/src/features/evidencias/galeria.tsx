import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import type { EvidenciaResumo } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Button, Muted, SectionLabel } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { escolherFoto, comprimirImagem } from "@/features/chat/media";
import { baixarEvidencia, listarEvidencias } from "./api";
import { cabeNoLimite } from "./limites";
import { enfileirarEvidencia, listarPendentesDaOs, tentarDeNovo, uriDaPendente, type EvidenciaPendente } from "./outbox";

const LADO_MINIATURA = 96;

/** Uma miniatura ja enviada. Precisa baixar com JWT — a listagem nao traz URL. */
function Miniatura({ osId, anexo }: { osId: string; anexo: EvidenciaResumo }) {
  const { token } = useAuth();
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    baixarEvidencia(osId, anexo.id, token)
      .then((local) => vivo && setUri(local))
      .catch(() => vivo && setUri(null));
    return () => {
      vivo = false;
    };
  }, [osId, anexo.id, token]);

  if (!uri) {
    return (
      <View
        style={{
          width: LADO_MINIATURA,
          height: LADO_MINIATURA,
          borderRadius: radius.sm,
          backgroundColor: colors.cardAlt,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={anexo.descricao || "Foto anexada a esta OS"}
      style={{ width: LADO_MINIATURA, height: LADO_MINIATURA, borderRadius: radius.sm }}
    />
  );
}

/**
 * Item ainda na fila. A foto ja esta no aparelho, entao mostra ELA (nao uma
 * caixa cinza) com um selo de estado por cima: "Enviando" enquanto espera a
 * rede, "Reenviar" quando o servidor recusou — e ai o toque reenfileira.
 */
function MiniaturaPendente({ pendente, aoTentarDeNovo }: { pendente: EvidenciaPendente; aoTentarDeNovo: () => void }) {
  const uri = uriDaPendente(pendente);
  const falhou = pendente.falhou;
  const corSelo = falhou ? colors.slaRed : "rgba(26,29,41,0.72)";

  return (
    <Pressable
      disabled={!falhou}
      onPress={aoTentarDeNovo}
      accessibilityRole="button"
      accessibilityLabel={falhou ? "Envio recusado. Toque para reenviar" : "Foto aguardando envio"}
      style={({ pressed }) => ({
        width: LADO_MINIATURA,
        height: LADO_MINIATURA,
        borderRadius: radius.sm,
        overflow: "hidden",
        backgroundColor: colors.cardAlt,
        borderWidth: falhou ? 1.5 : 0,
        borderColor: colors.slaRed,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Image source={{ uri }} style={{ width: "100%", height: "100%", opacity: falhou ? 0.55 : 0.8 }} />
      <View
        style={{
          position: "absolute",
          left: 6,
          right: 6,
          bottom: 6,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          paddingVertical: 4,
          paddingHorizontal: 6,
          borderRadius: radius.pill,
          backgroundColor: corSelo,
        }}
      >
        <Feather name={falhou ? "refresh-cw" : "upload-cloud"} size={11} color="#FFFFFF" />
        <Text style={{ color: "#FFFFFF", fontSize: font.size.xs - 1, fontWeight: font.weight.medium }} numberOfLines={1}>
          {falhou ? "Reenviar" : "Enviando"}
        </Text>
      </View>
    </Pressable>
  );
}

export function GaleriaEvidencias({ osId }: { osId: string }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [pendentes, setPendentes] = useState<EvidenciaPendente[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const query = useQuery({
    queryKey: ["evidencias", osId],
    enabled: !!token && !!osId,
    queryFn: () => listarEvidencias(osId, token),
  });

  const recarregarPendentes = useCallback(() => {
    void listarPendentesDaOs(osId).then(setPendentes);
  }, [osId]);

  useEffect(recarregarPendentes, [recarregarPendentes, query.data]);

  async function adicionar(fonte: "camera" | "galeria") {
    setOcupado(true);
    try {
      const uri = await escolherFoto(fonte);
      if (!uri) return;

      const { base64, mime } = await comprimirImagem(uri);

      // Recusar AQUI, no ato: descobrir o estouro so quando a fila tentar subir
      // esconderia a falha do tecnico, longe do momento da foto.
      if (!cabeNoLimite(base64)) {
        Alert.alert("Foto muito grande", "Mesmo comprimida a foto passou do limite de 2 MB. Tente enquadrar mais de perto.");
        return;
      }

      await enfileirarEvidencia(osId, { dados: base64, mimeType: mime as "image/jpeg" });
      recarregarPendentes();
      qc.invalidateQueries({ queryKey: ["evidencias", osId] });
    } catch {
      // Inclui falha ao GUARDAR a foto (disco cheio etc.): avisar agora e
      // melhor que a foto sumir da fila depois.
      Alert.alert("Não foi possível guardar a foto", "Tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  const enviadas = query.data ?? [];
  const vazio = enviadas.length === 0 && pendentes.length === 0;

  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel>Evidências</SectionLabel>

      {vazio && !query.isLoading ? (
        <Muted>Nenhuma foto anexada nesta OS.</Muted>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {enviadas.map((anexo) => (
            <Miniatura key={anexo.id} osId={osId} anexo={anexo} />
          ))}
          {pendentes.map((p) => (
            <MiniaturaPendente
              key={p.localId}
              pendente={p}
              aoTentarDeNovo={() => void tentarDeNovo(p.localId).finally(recarregarPendentes)}
            />
          ))}
        </ScrollView>
      )}

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button
          label="Tirar foto"
          variant="ghost"
          icon={<Feather name="camera" size={16} color={colors.ink} />}
          loading={ocupado}
          onPress={() => void adicionar("camera")}
        />
        <Button
          label="Da galeria"
          variant="ghost"
          icon={<Feather name="image" size={16} color={colors.ink} />}
          loading={ocupado}
          onPress={() => void adicionar("galeria")}
        />
      </View>
    </View>
  );
}
