import { Stack } from "expo-router";
import { colors } from "@/theme/tokens";
import { useProcessarFilaOffline } from "@/features/chat/outbox";

export default function ChatLayout() {
  useProcessarFilaOffline();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />;
}
