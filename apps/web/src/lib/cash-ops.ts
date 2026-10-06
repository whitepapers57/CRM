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
