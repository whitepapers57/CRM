import { cookies } from "next/headers";
import { defaultLocale, locales, translate, type Locale, type MessageKey } from "./messages";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get("locale")?.value;
  return locales.includes(value as Locale) ? (value as Locale) : defaultLocale;
}

export async function getT() {
  const locale = await getLocale();
  return (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);
}
