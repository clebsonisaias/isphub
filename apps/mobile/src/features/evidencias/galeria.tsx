import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import type { EvidenciaResumo } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { Button, Muted, SectionLabel } from "@/components/ui";
import { colors, radius, space } from "@/theme/tokens";
import { escolherFoto, comprimirImagem } from "@/features/chat/media";
import { baixarEvidencia, listarEvidencias } from "./api";
import { cabeNoLimite } from "./limites";
import { enfileirarEvidencia, listarPendentesDaOs, type EvidenciaPendente } from "./outbox";

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

/** Item ainda na fila: nao tem id do servidor, entao mostra estado em vez de imagem. */
function MiniaturaPendente({ pendente }: { pendente: EvidenciaPendente }) {
  return (
    <View
      style={{
        width: LADO_MINIATURA,
        height: LADO_MINIATURA,
        borderRadius: radius.sm,
        backgroundColor: colors.cardAlt,
        borderWidth: 1,
        borderColor: pendente.falhou ? colors.slaRed : colors.line2,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
      }}
    >
      <Feather
        name={pendente.falhou ? "alert-circle" : "clock"}
        size={18}
        color={pendente.falhou ? colors.slaRed : colors.muted}
      />
      <Muted style={{ fontSize: 10, textAlign: "center" }}>{pendente.falhou ? "Falhou" : "Aguardando envio"}</Muted>
    </View>
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
      Alert.alert("Não foi possível processar a foto", "Tente novamente.");
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
            <MiniaturaPendente key={p.localId} pendente={p} />
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
