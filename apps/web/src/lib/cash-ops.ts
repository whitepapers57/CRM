/** What each operation's form asks for — mirrors apps/api/src/cash/operations.ts (spec §4). */
export type Needs = "supplier" | "outlet" | "expenseCategory" | "incomeCategory" | "name" | "none";
export const NEEDS: Record<string, Needs> = {
  supplier_payment: "supplier", expense: "expenseCategory", payroll: "none", salary: "name",
  other_counterparty: "name", buyer_refund: "outlet", credit_repayment: "name", employee_loan: "name",
  cash_to_bank: "none", other_expense: "expenseCategory", accountable: "name", taxes: "expenseCategory",
  from_buyer: "outlet", supplier_refund: "supplier", employee_loan_return: "name", credit_received: "name",
  other_income: "incomeCategory",
};
export const DEPOSIT = "cash_to_bank";
export const needsOf = (op: string): Needs => NEEDS[op] ?? "none";

export type CashPageName = "cash-in" | "cash-out" | "bank-in" | "bank-out";
/** The «Создать» menu of each page — mirrors opsForPage in apps/api/src/cash/operations.ts (same order). */
const ALL_OUT = ["supplier_payment", "expense", "payroll", "salary", "other_counterparty", "buyer_refund", "credit_repayment", "employee_loan", "other_expense", "accountable", "taxes"];
const IN = ["from_buyer", "supplier_refund", "employee_loan_return", "credit_received", "other_income"];
export const OPS_FOR_PAGE: Record<CashPageName, string[]> = {
  "cash-out": [...ALL_OUT.slice(0, 8), DEPOSIT, ...ALL_OUT.slice(8)],
  "bank-out": ALL_OUT,
  "cash-in": IN,
  "bank-in": IN,
};

/** An amount as typed or copied from a table: spaces, NBSP (U+00A0) and narrow NBSP (U+202F) are thousands marks; "," is the decimal point. "" / junk → "". */
export const cleanAmount = (s: string): string => s.replace(/[\s  ]/g, "").replace(",", ".");
export const parseAmountInput = (s: string): number | null => {
  const c = cleanAmount(s);
  if (c === "" || !/^\d*\.?\d*$/.test(c) || c === ".") return null;
  return Number(c);
};

/** Fields of a cash edit snapshot (apps/api cash.service `snapshot`), in display order. */
export const CASH_SNAP_FIELDS = ["date", "amount", "account", "cashboxSdId", "bankAccountId", "supplierSdId", "outletSdId", "categoryId", "counterpartyName", "comment"] as const;
export type CashSnapField = (typeof CASH_SNAP_FIELDS)[number];
/** The snapshot fields that differ between before and after (null, undefined and "" count as empty). */
export const changedCashFields = (before: Record<string, unknown>, after: Record<string, unknown>): CashSnapField[] => {
  const v = (x: unknown) => (x == null || x === "" ? null : String(x));
  return CASH_SNAP_FIELDS.filter((f) => v(before[f]) !== v(after[f]));
};
