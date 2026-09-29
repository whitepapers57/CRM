import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", Number(value) < 0 && "text-destructive", className)}>
      {formatMoney(value)}
    </span>
  );
}
