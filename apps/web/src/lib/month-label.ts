import type { MessageKey } from "@/i18n/messages";

/** "2026-09" → "Сентябрь 2026", composed by hand (Intl gives "M09" for Uzbek). */
export function monthLabel(month: string, t: (key: MessageKey) => string): string {
  const [y, m] = month.split("-");
  return `${t(`month.${Number(m)}` as MessageKey)} ${y}`;
}

/** Audit times are real instants; show them in Tashkent wall time (UTC+5). */
export function tashkentInstant(iso: string): string {
  return new Date(Date.parse(iso) + 5 * 3600e3).toISOString();
}
