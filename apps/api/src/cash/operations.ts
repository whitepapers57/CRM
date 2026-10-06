import type { Account } from './cash-refs.service.js';

export type Needs = 'supplier' | 'outlet' | 'expenseCategory' | 'incomeCategory' | 'name' | 'none';
export type Direction = 'in' | 'out';

const BOTH: Account[] = ['cash', 'bank'];
/** Spec §4, in 1C's «Создать» order. */
export const OPERATIONS = {
  supplier_payment: { direction: 'out', accounts: BOTH, needs: 'supplier' },
  expense: { direction: 'out', accounts: BOTH, needs: 'expenseCategory' },
  payroll: { direction: 'out', accounts: BOTH, needs: 'none' },
  salary: { direction: 'out', accounts: BOTH, needs: 'name' },
  other_counterparty: { direction: 'out', accounts: BOTH, needs: 'name' },
  buyer_refund: { direction: 'out', accounts: BOTH, needs: 'outlet' },
  credit_repayment: { direction: 'out', accounts: BOTH, needs: 'name' },
  employee_loan: { direction: 'out', accounts: BOTH, needs: 'name' },
  cash_to_bank: { direction: 'out', accounts: ['cash'], needs: 'none', bankTarget: true },
  other_expense: { direction: 'out', accounts: BOTH, needs: 'expenseCategory' },
  accountable: { direction: 'out', accounts: BOTH, needs: 'name' },
  taxes: { direction: 'out', accounts: BOTH, needs: 'expenseCategory' },
  from_buyer: { direction: 'in', accounts: BOTH, needs: 'outlet' },
  supplier_refund: { direction: 'in', accounts: BOTH, needs: 'supplier' },
  employee_loan_return: { direction: 'in', accounts: BOTH, needs: 'name' },
  credit_received: { direction: 'in', accounts: BOTH, needs: 'name' },
  other_income: { direction: 'in', accounts: BOTH, needs: 'incomeCategory' },
} as const satisfies Record<string, { direction: Direction; accounts: readonly Account[]; needs: Needs; bankTarget?: true }>;

export type OpCode = keyof typeof OPERATIONS;
export const isOp = (v: unknown): v is OpCode => typeof v === 'string' && Object.hasOwn(OPERATIONS, v);

export type CashPage = 'cash-in' | 'cash-out' | 'bank-in' | 'bank-out';
export const PAGES: Record<CashPage, { account: Account; direction: Direction }> = {
  'cash-in': { account: 'cash', direction: 'in' },
  'cash-out': { account: 'cash', direction: 'out' },
  'bank-in': { account: 'bank', direction: 'in' },
  'bank-out': { account: 'bank', direction: 'out' },
};
export const isPage = (v: unknown): v is CashPage => typeof v === 'string' && Object.hasOwn(PAGES, v);

/** The «Создать» menu of a page. */
export const opsForPage = (page: CashPage): OpCode[] =>
  (Object.keys(OPERATIONS) as OpCode[]).filter((c) => {
    const o = OPERATIONS[c];
    return o.direction === PAGES[page].direction && (o.accounts as readonly Account[]).includes(PAGES[page].account);
  });

export const cashNumber = (seq: number) => `ДД-${String(seq).padStart(6, '0')}`;
