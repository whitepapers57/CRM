"use client";

import { useId } from "react";
import { Field } from "@/components/app/field";
import { Text } from "@/components/app/text";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { translate, type Locale, type MessageKey } from "@/i18n/messages";
import type { WorkSchedule } from "@/lib/api";
import { cn } from "@/lib/utils";

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const DEFAULT_DAY = { start: "09:00", end: "18:00" };

/**
 * «График работы»: off = null (the employee follows the position; `byPosition` says what that is),
 * on = a weekday toggle row, and start / end times for each ticked day. The error shows under the editor.
 */
export function ScheduleEditor({
  value,
  onChange,
  byPosition,
  error,
  locale,
}: {
  value: WorkSchedule | null;
  onChange: (next: WorkSchedule | null) => void;
  byPosition: string;
  error?: string;
  locale: Locale;
}) {
  const t = (key: MessageKey) => translate(locale, key);
  const id = useId();
  const custom = value !== null;
  const toggleDay = (d: number) => {
    const next = { ...(value ?? {}) };
    if (next[String(d)]) delete next[String(d)];
    else next[String(d)] = { ...DEFAULT_DAY };
    onChange(next);
  };
  const setTime = (d: string, part: "start" | "end", v: string) => onChange({ ...(value ?? {}), [d]: { ...(value ?? {})[d], [part]: v } });
  return (
    <div className="flex flex-col gap-2">
      <Label className="block text-xs text-muted-foreground">{t("kadry.schedule")}</Label>
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={custom}
          onCheckedChange={(on) => onChange(on ? { "1": { ...DEFAULT_DAY }, "2": { ...DEFAULT_DAY }, "3": { ...DEFAULT_DAY }, "4": { ...DEFAULT_DAY }, "5": { ...DEFAULT_DAY } } : null)}
        />
        <Label htmlFor={id} className="cursor-pointer text-sm font-normal">{t("kadry.schedule_custom")}</Label>
      </div>
      {!custom && <Text variant="caption">{byPosition}</Text>}
      {custom && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d) => {
              const on = Boolean(value[String(d)]);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "h-9 min-w-11 rounded-lg border px-2 text-sm transition active:scale-95",
                    on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                  )}
                >
                  {t(`kadry.wd.${d}` as MessageKey)}
                </button>
              );
            })}
          </div>
          {DAYS.filter((d) => value[String(d)]).map((d) => (
            <div key={d} className="flex flex-wrap items-end gap-2">
              <span className="w-8 pb-2 text-sm font-medium">{t(`kadry.wd.${d}` as MessageKey)}</span>
              <Field label={t("kadry.time_from")} type="time" className="w-28" value={value[String(d)].start} onChange={(e) => setTime(String(d), "start", e.target.value)} />
              <Field label={t("kadry.time_to")} type="time" className="w-28" value={value[String(d)].end} onChange={(e) => setTime(String(d), "end", e.target.value)} />
            </div>
          ))}
        </div>
      )}
      {error && <Text role="alert" variant="error" data-error>{error}</Text>}
    </div>
  );
}
