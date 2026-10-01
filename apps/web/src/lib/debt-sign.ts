import type { SupplierStatement } from "./api";

/** "1500.00" → "-1500.00" and back; zero stays "0.00". */
const flip = (v: string) => (Number(v) === 0 ? v.replace(/^-/, "") : v.startsWith("-") ? v.slice(1) : `-${v}`);

/**
 * The API reports what we owe a supplier as a positive balance. Supplier pages
 * show 1C's «Долг (+ нам, − мы)» instead, where what we owe is negative.
 */
export function toDebtSign(s: SupplierStatement): SupplierStatement {
  return {
    ...s,
    opening: flip(s.opening),
    closing: flip(s.closing),
    rows: s.rows.map((r) => ({ ...r, amount: flip(r.amount), balance: flip(r.balance) })),
  };
}
