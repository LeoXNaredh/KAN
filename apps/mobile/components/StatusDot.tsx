import { Text, View } from "react-native";

export type StatusLevel = "online" | "warning" | "offline";

const DOT_CLASS: Record<StatusLevel, string> = {
  online: "bg-success",
  warning: "bg-warning",
  offline: "bg-danger",
};

/** Equivalente nativo de apps/web/components/ui/StatusDot.tsx (docs/18, incremento 6). */
export function StatusDot({ level, label }: { level: StatusLevel; label: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <View className={`h-2 w-2 rounded-full ${DOT_CLASS[level]}`} />
      <Text className="text-sm text-ink">{label}</Text>
    </View>
  );
}
