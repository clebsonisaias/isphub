import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { StatusPreset } from "@isphub/shared";
import { USER_ROLE_LABEL } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { checarBiometria, iconeBiometria, rotuloBiometria, type BiometriaInfo } from "@/lib/biometria";
import { Avatar, useAvatarUri } from "@/features/chat/avatar";
import { escolherFoto } from "@/features/chat/media";
import { comprimirAvatar } from "@/features/perfil/media";
import { atualizarPerfil, atualizarStatus, enviarFoto, removerFoto } from "@/features/perfil/api";
import { StatusPicker } from "@/features/perfil/status-picker";
import { Button, Card, Field, Hero, Muted, Screen } from "@/components/ui";
import { colors, font, space } from "@/theme/tokens";

export default function Perfil() {
  const { usuario, token, refetchMe, logout, biometriaAtiva, ativarBiometria, desativarBiometria } = useAuth();
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [bioInfo, setBioInfo] = useState<BiometriaInfo | null>(null);
  const [alternandoBio, setAlternandoBio] = useState(false);
  const [statusLocal, setStatusLocal] = useState<StatusPreset | null>(usuario?.status ?? null);
  const [textoLocal, setTextoLocal] = useState(usuario?.statusTexto ?? "");
  const [salvandoStatus, setSalvandoStatus] = useState(false);
  const fotoUri = useAvatarUri(usuario?.id, usuario?.temFoto, usuario?.fotoVersao);

  const [nomeExibicao, setNomeExibicao] = useState(usuario?.nomeExibicao ?? "");
  const [bio, setBio] = useState(usuario?.bio ?? "");
  const [telefoneContato, setTelefoneContato] = useState(usuario?.telefoneContato ?? "");
  const [assinaturaChat, setAssinaturaChat] = useState(usuario?.assinaturaChat ?? "");
  const [corDestaque, setCorDestaque] = useState(usuario?.corDestaque ?? "");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);

  useEffect(() => {
    let vivo = true;
    checarBiometria().then((info) => {
      if (vivo) setBioInfo(info);
    });
    return () => {
      vivo = false;
    };
  }, []);

  async function handleAlternarBiometria(ligar: boolean) {
    setAlternandoBio(true);
    try {
      if (ligar) {
        const ok = await ativarBiometria();
        if (!ok) return; // usuario cancelou a leitura — o switch volta sozinho
      } else {
        await desativarBiometria();
      }
    } finally {
      setAlternandoBio(false);
    }
  }

  if (!usuario) return null;

  async function processarFoto(uri: string) {
    setEnviandoFoto(true);
    try {
      const { base64, mime } = await comprimirAvatar(uri);
      await enviarFoto(base64, mime, token);
      await refetchMe();
    } catch {
      Alert.alert("Não foi possível processar a foto");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function handleRemoverFoto() {
    setEnviandoFoto(true);
    try {
      await removerFoto(token);
      await refetchMe();
    } catch {
      Alert.alert("Não foi possível remover a foto");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function selecionarEProcessar(fonte: "camera" | "galeria") {
    const uri = await escolherFoto(fonte);
    if (uri) await processarFoto(uri);
  }

  function handleTrocarFoto() {
    Alert.alert("Foto de perfil", "Escolher origem", [
      { text: "Câmera", onPress: () => void selecionarEProcessar("camera") },
      { text: "Galeria", onPress: () => void selecionarEProcessar("galeria") },
      ...(usuario!.temFoto ? [{ text: "Remover foto", style: "destructive" as const, onPress: () => void handleRemoverFoto() }] : []),
      { text: "Cancelar", style: "cancel" as const },
    ]);
  }

  async function handleSalvarStatus() {
    setSalvandoStatus(true);
    try {
      await atualizarStatus(statusLocal, textoLocal, token);
      await refetchMe();
    } catch {
      Alert.alert("Não foi possível atualizar o status");
    } finally {
      setSalvandoStatus(false);
    }
  }

  async function handleSalvarPerfil() {
    if (corDestaque && !/^#[0-9a-fA-F]{6}$/.test(corDestaque)) {
      Alert.alert("Cor inválida", "Use o formato #rrggbb");
      return;
    }
    setSalvandoPerfil(true);
    try {
      await atualizarPerfil(
        {
          nomeExibicao: nomeExibicao.trim() || null,
          bio: bio.trim() || null,
          telefoneContato: telefoneContato.trim() || null,
          assinaturaChat: assinaturaChat.trim() || null,
          corDestaque: corDestaque.trim() || null,
        },
        token,
      );
      await refetchMe();
    } catch {
      Alert.alert("Não foi possível salvar o perfil");
    } finally {
      setSalvandoPerfil(false);
    }
  }

  function handleLogout() {
    Alert.alert("Sair", "Deseja encerrar a sessão neste aparelho?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => void logout() },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Perfil" }} />
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingVertical: space.lg, paddingBottom: space.xxl }}>
        <Hero
          title={usuario.nome}
          subtitle={USER_ROLE_LABEL[usuario.role]}
          right={
            <Pressable onPress={handleTrocarFoto} disabled={enviandoFoto}>
              <Avatar nome={usuario.nome} fotoUri={fotoUri} size="lg" />
              <View style={styles.camBadge}>
                <Feather name="camera" size={11} color={colors.brand} />
              </View>
            </Pressable>
          }
        />
        <Muted style={{ marginTop: -space.sm }}>{enviandoFoto ? "Enviando foto…" : usuario.email}</Muted>

        <Card style={{ gap: space.md }}>
          <Text style={{ fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink2 }}>Status</Text>
          <StatusPicker status={statusLocal} statusTexto={textoLocal} onMudarStatus={setStatusLocal} onMudarTexto={setTextoLocal} />
          <Button label={salvandoStatus ? "Salvando…" : "Salvar status"} onPress={handleSalvarStatus} loading={salvandoStatus} />
        </Card>

        <Card style={{ gap: space.md }}>
          <Text style={{ fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink2 }}>Sobre mim</Text>
          <Field value={nomeExibicao} onChangeText={setNomeExibicao} placeholder="Nome de exibição" maxLength={80} />
          <Field value={bio} onChangeText={setBio} placeholder="Bio" multiline maxLength={280} style={{ minHeight: 64 }} />
          <Field value={telefoneContato} onChangeText={setTelefoneContato} placeholder="Telefone de contato" maxLength={30} />
          <Field value={assinaturaChat} onChangeText={setAssinaturaChat} placeholder="Assinatura do chat" maxLength={140} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Field
              value={corDestaque}
              onChangeText={setCorDestaque}
              placeholder="#6366f1"
              maxLength={7}
              style={{ flex: 1 }}
            />
            {/^#[0-9a-fA-F]{6}$/.test(corDestaque) && (
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: corDestaque, borderWidth: 1, borderColor: colors.line }} />
            )}
          </View>
          <Button label={salvandoPerfil ? "Salvando…" : "Salvar perfil"} onPress={handleSalvarPerfil} loading={salvandoPerfil} />
        </Card>

        {bioInfo?.disponivel ? (
          <Card style={{ gap: space.sm }}>
            <Text style={{ fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink2 }}>Segurança</Text>
            <View style={styles.bioRow}>
              <View style={styles.bioIcon}>
                <Feather name={iconeBiometria(bioInfo.tipo)} size={18} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bioTitulo}>Desbloqueio por {rotuloBiometria(bioInfo.tipo)}</Text>
                <Muted>Entre no app sem digitar a senha.</Muted>
              </View>
              <Switch
                value={biometriaAtiva}
                disabled={alternandoBio}
                onValueChange={(v) => void handleAlternarBiometria(v)}
                trackColor={{ true: colors.brand, false: colors.line2 }}
                thumbColor={colors.card}
              />
            </View>
          </Card>
        ) : null}

        <Pressable onPress={handleLogout} style={{ alignItems: "center", paddingVertical: space.md }}>
          <Text style={{ fontSize: font.size.base, fontWeight: font.weight.medium as "600", color: colors.slaRed }}>Sair</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  camBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.brand,
  },
  bioRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  bioIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.brandBg,
    alignItems: "center",
    justifyContent: "center",
  },
  bioTitulo: { fontSize: font.size.base, fontWeight: font.weight.medium as "600", color: colors.ink },
});
