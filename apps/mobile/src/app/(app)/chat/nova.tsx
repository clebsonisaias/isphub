import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { ContatoChat, FilaItem } from "@isphub/shared";
import { UserRole } from "@isphub/shared";
import { useAuth } from "@/lib/auth";
import { apiFetch, buildFilaQuery } from "@/lib/api";
import { Field, Muted, Screen, Title } from "@/components/ui";
import { colors, font, radius, space } from "@/theme/tokens";
import { Avatar } from "@/features/chat/avatar";
import { useContatos, useCriarConversa } from "@/features/chat/hooks";

type Aba = "pessoas" | "grupo" | "os";

function SegmentButton({ label, ativo, onPress }: { label: string; ativo: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segButton, ativo && styles.segButtonAtivo]}>
      <Text style={[styles.segTexto, ativo && styles.segTextoAtivo]}>{label}</Text>
    </Pressable>
  );
}

export default function NovaConversa() {
  const { token, usuario } = useAuth();
  const router = useRouter();
  const podeCriarGrupo = usuario?.role === UserRole.ADMIN || usuario?.role === UserRole.GESTOR;
  const [aba, setAba] = useState<Aba>("pessoas");
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const contatosQuery = useContatos();
  const { criarDireta, criarGrupo, garantirConversaDeOs } = useCriarConversa();

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [tituloGrupo, setTituloGrupo] = useState("");

  const [buscaOs, setBuscaOs] = useState("");
  const [resultadosOs, setResultadosOs] = useState<FilaItem[]>([]);
  const [buscandoOs, setBuscandoOs] = useState(false);

  useEffect(() => {
    if (buscaOs.trim().length < 2) {
      setResultadosOs([]);
      return;
    }
    let cancelado = false;
    setBuscandoOs(true);
    const t = setTimeout(() => {
      apiFetch<{ itens: FilaItem[] }>(`/fila${buildFilaQuery({ busca: buscaOs.trim(), grupo: "abertos" })}`, { token })
        .then((r) => !cancelado && setResultadosOs(r.itens.slice(0, 8)))
        .catch(() => !cancelado && setResultadosOs([]))
        .finally(() => !cancelado && setBuscandoOs(false));
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [buscaOs, token]);

  const contatosFiltrados = (contatosQuery.data ?? []).filter((c) => c.nome.toLowerCase().includes(buscaPessoa.trim().toLowerCase()));

  function abrirConversa(id: string) {
    router.replace(`/chat/${id}`);
  }

  function handleAbrirDireta(c: ContatoChat) {
    criarDireta.mutate(c.id, { onSuccess: (conversa) => abrirConversa(conversa.id) });
  }

  function toggleSelecionado(id: string) {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function handleCriarGrupo() {
    if (!tituloGrupo.trim() || selecionados.size === 0) return;
    criarGrupo.mutate(
      { titulo: tituloGrupo.trim(), participanteIds: Array.from(selecionados) },
      { onSuccess: (conversa) => abrirConversa(conversa.id) },
    );
  }

  function handleAbrirOs(item: FilaItem) {
    garantirConversaDeOs.mutate(item.id, { onSuccess: (conversa) => abrirConversa(conversa.id) });
  }

  return (
    <Screen>
      <View style={{ paddingVertical: space.md }}>
        <Title>Nova conversa</Title>
      </View>

      <View style={styles.segRow}>
        <SegmentButton label="Pessoas" ativo={aba === "pessoas"} onPress={() => setAba("pessoas")} />
        {podeCriarGrupo && <SegmentButton label="Grupo" ativo={aba === "grupo"} onPress={() => setAba("grupo")} />}
        <SegmentButton label="OS" ativo={aba === "os"} onPress={() => setAba("os")} />
      </View>

      {aba === "pessoas" && (
        <View style={{ flex: 1 }}>
          <Field placeholder="Buscar por nome…" value={buscaPessoa} onChangeText={setBuscaPessoa} />
          {contatosQuery.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: space.lg }} />
          ) : (
            <FlatList
              data={contatosFiltrados}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingTop: space.sm }}
              ListEmptyComponent={<Muted style={{ marginTop: space.md }}>Ninguém encontrado.</Muted>}
              renderItem={({ item }) => (
                <Pressable onPress={() => handleAbrirDireta(item)} style={styles.linhaContato} disabled={criarDireta.isPending}>
                  <Avatar nome={item.nome} online={item.online} size="sm" />
                  <Text style={styles.nomeContato}>{item.nome}</Text>
                </Pressable>
              )}
            />
          )}
        </View>
      )}

      {aba === "grupo" && podeCriarGrupo && (
        <View style={{ flex: 1 }}>
          <Field placeholder="Nome do grupo" value={tituloGrupo} onChangeText={setTituloGrupo} />
          <FlatList
            data={contatosQuery.data ?? []}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ paddingTop: space.sm }}
            renderItem={({ item }) => (
              <Pressable onPress={() => toggleSelecionado(item.id)} style={styles.linhaContato}>
                <View style={[styles.checkbox, selecionados.has(item.id) && styles.checkboxMarcado]} />
                <Avatar nome={item.nome} size="sm" />
                <Text style={styles.nomeContato}>{item.nome}</Text>
              </Pressable>
            )}
          />
          <Pressable
            onPress={handleCriarGrupo}
            disabled={!tituloGrupo.trim() || selecionados.size === 0 || criarGrupo.isPending}
            style={[styles.botaoCriar, (!tituloGrupo.trim() || selecionados.size === 0) && { opacity: 0.5 }]}
          >
            <Text style={styles.botaoCriarTexto}>{criarGrupo.isPending ? "Criando…" : "Criar grupo"}</Text>
          </Pressable>
        </View>
      )}

      {aba === "os" && (
        <View style={{ flex: 1 }}>
          <Field placeholder="Buscar OS por cliente, protocolo, contrato…" value={buscaOs} onChangeText={setBuscaOs} />
          {buscandoOs && <ActivityIndicator color={colors.brand} style={{ marginTop: space.md }} />}
          <FlatList
            data={resultadosOs}
            keyExtractor={(i) => i.id}
            contentContainerStyle={{ paddingTop: space.sm }}
            ListEmptyComponent={
              !buscandoOs && buscaOs.trim().length >= 2 ? <Muted style={{ marginTop: space.md }}>Nenhuma OS encontrada.</Muted> : null
            }
            renderItem={({ item }) => (
              <Pressable onPress={() => handleAbrirOs(item)} style={styles.linhaOs} disabled={garantirConversaDeOs.isPending}>
                <Text style={styles.osId}>OS #{item.sgpOsId}</Text>
                <Text style={styles.osCliente} numberOfLines={1}>
                  {item.clienteNome ?? "Sem cliente"}
                </Text>
              </Pressable>
            )}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  segRow: { flexDirection: "row", gap: space.xs, marginBottom: space.md },
  segButton: { flex: 1, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: "center" },
  segButtonAtivo: { backgroundColor: colors.brand, borderColor: colors.brand },
  segTexto: { fontSize: font.size.sm, fontWeight: font.weight.medium as "600", color: colors.ink2 },
  segTextoAtivo: { color: colors.onBrand },
  linhaContato: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm },
  nomeContato: { fontSize: font.size.base, color: colors.ink },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.line2 },
  checkboxMarcado: { backgroundColor: colors.brand, borderColor: colors.brand },
  botaoCriar: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: space.sm },
  botaoCriarTexto: { color: colors.onBrand, fontSize: font.size.lg, fontWeight: font.weight.medium as "600" },
  linhaOs: { paddingVertical: space.sm, gap: 2 },
  osId: { fontSize: font.size.xs, fontWeight: font.weight.bold as "700", color: colors.ink },
  osCliente: { fontSize: font.size.sm, color: colors.ink2 },
});
