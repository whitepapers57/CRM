"use client";

import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * The shared dropdown (design-system popup, not the browser's native list).
 * `name` submits the chosen value with an ordinary form; value "" means "all".
 */
export function Select({
  name,
  defaultValue = "",
  options,
  ariaLabel,
  className,
}: {
  name: string;
  defaultValue?: string;
  options: SelectOption[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <SelectRoot name={name} defaultValue={defaultValue} items={options}>
      <SelectTrigger aria-label={ariaLabel} className={cn("h-9 min-w-44 active:scale-[0.98]", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-(--anchor-width) max-w-96">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
