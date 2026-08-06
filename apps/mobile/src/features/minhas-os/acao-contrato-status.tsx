import { useState } from "react";
import { Alert, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  STATUS_CONTRATO,
  alvosPermitidos,
  rotuloDoTexto,
  type CodigoStatusContrato,
  type OrdemServico,
  type UserRole,
} from "@isphub/shared";
import { Button, Muted, SectionLabel } from "@/components/ui";
import { colors, space } from "@/theme/tokens";

/**
 * Mudar o status do CONTRATO no SGP, da tela da OS.
 *
 * PRO TECNICO isso e exatamente UMA acao — reativar contrato inativo — e por
 * isso vira um botao, nao um seletor. Quem esta na porta do cliente com a ONU na
 * mao nao vai navegar num dropdown pra escolher a unica opcao que existe.
 *
 * A lista sai de `alvosPermitidos`, a MESMA funcao que o servidor usa pra
 * recusar. Nao ha `if (role === TECNICO)` aqui: se a regra mudar, muda num lugar
 * so e as duas pontas seguem juntas.
 */
export function AcaoContratoStatus({
  os,
  role,
  executando,
  onAplicar,
}: {
  os: OrdemServico;
  role: UserRole | undefined;
  executando: boolean;
  onAplicar: (codigo: CodigoStatusContrato) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const alvos = role ? alvosPermitidos(role, os.contratoStatus) : [];

  // Sem contrato vinculado nao ha o que mudar; sem alvo permitido, o bloco
  // inteiro some em vez de aparecer desabilitado — botao morto em tela de campo
  // e ruido que a pessoa tenta tocar.
  if (!os.contratoId || alvos.length === 0) return null;

  const atual = rotuloDoTexto(os.contratoStatus);
  const acaoUnica = alvos.length === 1 ? alvos[0] : null;

  function confirmar(codigo: CodigoStatusContrato) {
    // Confirmacao obrigatoria: isto escreve no ERP de producao do provedor.
    // Reativar libera o servico de um cliente real; um toque acidental com o
    // celular no bolso nao pode ter esse efeito.
    Alert.alert(
      `Mudar contrato para ${STATUS_CONTRATO[codigo]}?`,
      `Contrato ${os.contratoId} · hoje está ${atual}.\n\nA mudança é gravada no SGP e fica no histórico desta OS com o seu nome.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          // `destructive` so quando tira o cliente do ar (cancelar/suspender).
          style: codigo === 3 || codigo === 4 ? "destructive" : "default",
          onPress: () => onAplicar(codigo),
        },
      ],
    );
  }

  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel>Contrato</SectionLabel>
      <Muted>
        {os.contratoId} · atualmente {atual}
      </Muted>

      {acaoUnica ? (
        <Button
          label={executando ? "Aplicando…" : acaoUnica === 1 ? "Reativar contrato" : `Mudar para ${STATUS_CONTRATO[acaoUnica]}`}
          icon={<Feather name="zap" size={16} color={colors.ink} />}
          loading={executando}
          onPress={() => confirmar(acaoUnica)}
        />
      ) : (
        <>
          <Button
            label={aberto ? "Fechar" : "Mudar status do contrato"}
            variant="ghost"
            icon={<Feather name="edit-2" size={16} color={colors.ink} />}
            onPress={() => setAberto((v) => !v)}
          />
          {aberto &&
            alvos.map((c) => (
              <Button
                key={c}
                label={STATUS_CONTRATO[c]}
                variant="ghost"
                loading={executando}
                onPress={() => confirmar(c)}
              />
            ))}
        </>
      )}
    </View>
  );
}
