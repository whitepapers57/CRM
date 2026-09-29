import { formatDateTime } from "@/lib/format";
import { Text } from "./text";

/** dataAsOf is a real instant; show it in Tashkent time (UTC+5, no DST). */
export function DataAsOf({ iso, label, never }: { iso: string | null; label: (time: string) => string; never: string }) {
  if (!iso) return <Text variant="caption">{never}</Text>;
  const wall = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000).toISOString();
  return <Text variant="caption">{label(formatDateTime(wall))}</Text>;
}
