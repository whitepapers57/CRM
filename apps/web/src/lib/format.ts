const moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const pad = (n: number) => String(n).padStart(2, "0");

/** API money is a decimal string; Number is safe for display at UZS magnitudes. */
export const formatMoney = (v: string) => moneyFmt.format(Number(v));
export const formatQty = (v: string) => qtyFmt.format(Number(v));

/** Stored times are Tashkent wall time in UTC fields: read them with UTC getters. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
