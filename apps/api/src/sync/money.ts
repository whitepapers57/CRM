import { Prisma } from '../generated/prisma/client.js';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));

/** Salesdoc money (a JS float) as an exact 2-decimal value. */
export function money(v: unknown): Prisma.Decimal {
  return new Prisma.Decimal(num(v)).toDecimalPlaces(2);
}

/** Quantities keep 3 decimals (weights, part packs). */
export function qty(v: unknown): Prisma.Decimal {
  return new Prisma.Decimal(num(v)).toDecimalPlaces(3);
}
