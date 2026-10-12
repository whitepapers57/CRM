"use client";

import { CalendarIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { ru, uz } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { translate, type Locale } from "@/i18n/messages";
import { dateToDay, dayToDate } from "@/lib/day";
import { cn } from "@/lib/utils";
import { Text } from "./text";

const locales = { ru, uz };
const shown = (day: string) => (day ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : "");

/** A day picker in the design system's popover; value is "YYYY-MM-DD", error shows under the field. */
export function DateField({
  label,
  value,
  onChange,
  min,
  error,
  locale,
  clearable,
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
  min?: string;
  error?: string;
  locale: Locale;
  /** Optional dates: a clear button that empties the field (calls onChange("")). */
  clearable?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative w-36">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "flex h-9 w-36 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm tabular-nums transition active:scale-[0.98]",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive",
          )}
        >
          {shown(value)}
          <CalendarIcon className="size-4 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            locale={locales[locale]}
            selected={value ? dayToDate(value) : undefined}
            defaultMonth={value ? dayToDate(value) : undefined}
            disabled={min ? { before: dayToDate(min) } : undefined}
            onSelect={(d) => {
              if (!d) return;
              onChange(dateToDay(d));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {clearable && value && (
        <button
          type="button"
          aria-label={translate(locale, "common.clear")}
          onClick={() => onChange("")}
          className="absolute top-1/2 right-7 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition hover:text-foreground active:scale-90"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
      </div>
      {error && (
        <Text id={errorId} role="alert" variant="error" className="mt-1">
          {error}
        </Text>
      )}
    </div>
  );
}
