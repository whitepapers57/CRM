// Keep both locales in the same key order.
export const messages = {
  ru: {
    "app.title": "Distribution Finance",
    "app.subtitle": "Финансы дистрибуции на данных Salesdoc",
    "status.api": "API",
    "status.database": "База данных",
    "status.salesdoc": "Salesdoc",
    "status.up": "Работает",
    "status.down": "Недоступно",
    "status.not_configured": "Не настроено",
    "status.not_configured_hint":
      "Добавьте доступ в apps/api/data/salesdoc.json",
    "status.connected_as": "Подключено как {userId}",
    "errors.unknown": "Что-то пошло не так",
  },
  uz: {
    "app.title": "Distribution Finance",
    "app.subtitle": "Salesdoc ma'lumotlari asosida distribyutsiya moliyasi",
    "status.api": "API",
    "status.database": "Ma'lumotlar bazasi",
    "status.salesdoc": "Salesdoc",
    "status.up": "Ishlayapti",
    "status.down": "Mavjud emas",
    "status.not_configured": "Sozlanmagan",
    "status.not_configured_hint":
      "Kirish ma'lumotlarini apps/api/data/salesdoc.json ga qo'shing",
    "status.connected_as": "{userId} sifatida ulangan",
    "errors.unknown": "Nimadir xato ketdi",
  },
} as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof (typeof messages)["ru"];

export const defaultLocale: Locale = "ru";

export function t(
  key: MessageKey,
  vars: Record<string, string> = {},
  locale: Locale = defaultLocale,
): string {
  return messages[locale][key].replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}
