# Деньги (cash and bank) and the «История» button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enter cash and bank operations (supplier payments, expenses, salaries, loans, taxes…) in our app, show them with Salesdoc's buyer payments on four 1C-style pages, feed supplier «Оплачено», and move every page's history behind an «История» button.

**Architecture:** A new NestJS module `cash` owns three reference tables (bank accounts, статьи, payment-type → account map) and `CashOperation`. One definition table (`operations.ts`) drives validation, the «Создать» menus and the labels. Lists merge our operations with Salesdoc `Payment` rows on the read side; nothing is written to Salesdoc. Settlements read supplier payments from `CashOperation`. The web gets a «Деньги» section (shared `SectionPanel`), a form per operation, and a shared `HistoryButton` that wraps the existing `HistoryList` in a dialog.

**Tech Stack:** NestJS 12 + Prisma 7 (Postgres on Supabase; tests on local `DATABASE_URL_TEST`), vitest; Next.js 16 server components + server actions, Tailwind 4, shadcn/Base UI; ru/uz messages.

**Spec:** `docs/superpowers/specs/2026-10-06-dengi-kassa-design.md`

## Global Constraints

- Currency UZS only; amount > 0, at most 2 decimals (`Decimal(18,2)`).
- Dates are days (Tashkent), ≥ `2026-09-01` (`DATA_START`), ≤ today (Tashkent).
- A closed month refuses create, edit, cancel and restore: 409 «Месяц закрыт» (current and target month).
- Nothing is written to Salesdoc. Buyer payments = Salesdoc `Payment` with `transactionType = 3`, read-only.
- Audit log is append-only; new actions `cash.create`, `cash.edit`, `cash.cancel`, `cash.restore`, target = operation id.
- Every new user-visible word exists in ru and uz, same key order in `messages.ts`; Uzbek month names composed by hand.
- Each form error shows under its own field; every button gives press feedback and a spinner while waiting.
- Superseded code is commented out, not deleted (owner's rule); LF line endings (`.gitattributes`); write files from Python with `newline='\n'`.
- Migrations: `DATABASE_URL="$DATABASE_URL_LOCAL" npx prisma migrate dev --name <n>` in `apps/api`, then `npx prisma migrate deploy` for Supabase (no shadow DB rights there).
- Never run CPU-heavy jobs without need; stop nothing the owner started.
- The sync deletes and recreates `PaymentType` rows: never add our own columns to synced tables.

## Review Focus

- **A Salesdoc payment type with an unexpected name** (neither «Наличный», «Терминал» nor «Перечисление») must still land on exactly one page (default касса) and be changeable — Task 2 test `defaults an unknown payment type to cash`.
- **Editing an operation's date from an open into a closed month** must be refused even though the current month is open — Task 3 test `refuses moving into a closed month`.
- **A cancelled operation** must count nowhere: not in a page's Итого, not in supplier «Оплачено» — Task 4 test `cancelled rows stay listed but do not count` and Task 5 test `ignores cancelled payments`.
- **«Взнос наличными в банк» cancelled** must disappear from both Расход из кассы and Поступления на счёт totals at once — Task 4 test `cash-to-bank shows on both pages and cancels on both`.
- **Deactivating a статья used by old operations** must keep those operations readable (name still shown) while hiding the статья from new forms — Task 2 test `deactivated category stays on old operations`.

---

## File structure

API (`apps/api`):
- `prisma/schema.prisma` — models `BankAccount`, `CashCategory`, `PaymentTypeAccount`, `CashOperation`.
- `src/cash/operations.ts` — the operation catalogue (code, direction, accounts, what it needs) and `pageOf()`.
- `src/cash/cash-refs.service.ts` — bank accounts, статьи, payment-type accounts.
- `src/cash/cash.service.ts` — create / update / cancel / restore / get, lists per page, history per page, form options.
- `src/cash/cash.controller.ts`, `src/cash/cash.module.ts`.
- `src/audit/audit.service.ts` — new actions; `src/audit/audit.controller.ts` — `GET /audit`.
- `src/settlements/settlements.service.ts` — supplier «Оплачено».

Web (`apps/web/src`):
- `components/app/history-button.tsx` — «История» dialog around `HistoryList`.
- `lib/dengi-menu.ts`, `app/dengi/page.tsx`, `app/dengi/[page]/page.tsx` (four lists), `app/dengi/op/[id]/page.tsx`, `app/dengi/op/new/page.tsx`, `app/dengi/op/[id]/edit/page.tsx`, `app/dengi/cash-form.tsx`, `app/dengi/op-actions.tsx`, `app/dengi/actions.ts`, `app/dengi/peremeshcheniya/page.tsx`, `app/dengi/stati/page.tsx`, `app/dengi/scheta/page.tsx`, `app/dengi/refs-actions.ts`, `app/dengi/ref-row.tsx`.
- Modified: `app/layout.tsx`, `i18n/messages.ts`, `lib/api.ts`, receipt page, receipts list, months page.

---

### Task 1: Schema, migration, audit actions

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/audit/audit.service.ts`
- Create: migration `…_cash` (generated)
- Test: `apps/api/src/cash/schema.spec.ts`

**Interfaces:**
- Produces: Prisma models `BankAccount {id,name,active,createdAt}`, `CashCategory {id,name,kind,active,createdAt}`, `PaymentTypeAccount {paymentTypeSdId,account}`, `CashOperation {…}` (below); `AuditAction` gains `'cash.create' | 'cash.edit' | 'cash.cancel' | 'cash.restore'`.

- [ ] **Step 1: Write the failing test** — `apps/api/src/cash/schema.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';

const db = createTestDb();

describe('cash schema', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('numbers operations in order and stores days and amounts exactly', async () => {
    const acc = await db.bankAccount.create({ data: { name: 'Основной счёт' } });
    const a = await db.cashOperation.create({
      data: { direction: 'out', account: 'bank', bankAccountId: acc.id, date: new Date('2026-10-02'), amount: '10500000.25', operation: 'supplier_payment', supplierSdId: '1', createdById: 'u1', createdByName: 'Сардор' },
    });
    const b = await db.cashOperation.create({
      data: { direction: 'in', account: 'cash', cashboxSdId: '1', date: new Date('2026-10-03'), amount: 5, operation: 'other_income', counterpartyName: 'x', createdById: 'u1', createdByName: 'Сардор' },
    });
    expect(b.seq).toBe(a.seq + 1);
    expect(a.amount.toString()).toBe('10500000.25');
    expect(a.date.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(a.cancelledAt).toBeNull();
  });

  it('keeps one account per payment type', async () => {
    await db.paymentTypeAccount.create({ data: { paymentTypeSdId: 'd0_1', account: 'cash' } });
    await expect(db.paymentTypeAccount.create({ data: { paymentTypeSdId: 'd0_1', account: 'bank' } })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it** — `cd apps/api && npx vitest run src/cash/schema.spec.ts` · Expected: FAIL, `db.bankAccount` undefined (TypeScript/property error).

- [ ] **Step 3: Schema** — append to `schema.prisma`:

```prisma
/// Our bank accounts (placeholder: «Основной счёт» until the owner lists them).
model BankAccount {
  id        String   @id @default(uuid())
  name      String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
}

/// Статьи движения денег. kind: "expense" | "income".
model CashCategory {
  id        String   @id @default(uuid())
  name      String
  kind      String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
}

/// Which page a Salesdoc payment type lands on. Not a column on PaymentType: the sync recreates those rows.
model PaymentTypeAccount {
  paymentTypeSdId String @id
  account         String /// "cash" | "bank"
}

/// Money in or out, entered in our app (spec §3–4). Never deleted; cancelled instead.
model CashOperation {
  id               String    @id @default(uuid())
  seq              Int       @unique @default(autoincrement())
  direction        String    /// "in" | "out"
  account          String    /// "cash" | "bank"
  cashboxSdId      String?
  bankAccountId    String?
  date             DateTime  @db.Date
  amount           Decimal   @db.Decimal(18, 2)
  operation        String    /// a code from src/cash/operations.ts
  supplierSdId     String?
  outletSdId       String?
  categoryId       String?
  counterpartyName String?
  comment          String?
  createdById      String
  createdByName    String
  createdAt        DateTime  @default(now())
  cancelledAt      DateTime?
  cancelledById    String?
  cancelledByName  String?
  cancelReason     String?

  @@index([account, direction, date])
  @@index([supplierSdId, date])
}
```

Then create the migration without applying it: `cd apps/api && DATABASE_URL="$DATABASE_URL_LOCAL" npx prisma migrate dev --create-only --name cash` (bash: `export $(grep DATABASE_URL_LOCAL .env | xargs)` first if needed). Append the seed SQL to the end of the generated `migration.sql`:

```sql
INSERT INTO "BankAccount" ("id", "name") VALUES (gen_random_uuid()::text, 'Основной счёт');
INSERT INTO "CashCategory" ("id", "name", "kind") VALUES (gen_random_uuid()::text, 'Прочие расходы', 'expense'), (gen_random_uuid()::text, 'Прочие доходы', 'income');
```

then apply it locally with `DATABASE_URL="$DATABASE_URL_LOCAL" npx prisma migrate dev` (applies the edited file and regenerates the client). Never `migrate reset`.

- [ ] **Step 4: Audit actions** — in `audit.service.ts`:

```ts
export type AuditAction =
  | 'purchase.edit' | 'purchase.delete' | 'purchase.restore'
  | 'month.close' | 'month.open'
  | 'cash.create' | 'cash.edit' | 'cash.cancel' | 'cash.restore';
```

and give `list` an optional `targets?: string[]` filter: `...(where.targets ? { target: { in: where.targets } } : {})`.

- [ ] **Step 5: Run** — `npx vitest run src/cash/schema.spec.ts` · Expected: PASS 2/2. Then `npx tsc --noEmit -p tsconfig.json` · Expected: no output.

- [ ] **Step 6: Apply to Supabase** — `npx prisma migrate deploy` · Expected: «1 migration applied».

- [ ] **Step 7: Commit** — `git add apps/api && git commit -m "feat(api): cash schema — operations, bank accounts, статьи, payment-type accounts"`

---

### Task 2: Reference data — bank accounts, статьи, payment-type accounts

**Files:**
- Create: `apps/api/src/cash/cash-refs.service.ts`, `apps/api/src/cash/cash-refs.service.spec.ts`
- Create: `apps/api/src/cash/cash.module.ts` (registered in `app.module.ts`), `apps/api/src/cash/cash.controller.ts` (refs routes now, operations routes in Task 4)

**Interfaces:**
- Produces:
  - `CashRefsService.bankAccounts(): Promise<Array<{id,name,active}>>`, `addBankAccount(name)`, `renameBankAccount(id,name)`, `setBankAccountActive(id,active)`
  - `categories(): Promise<Array<{id,name,kind,active}>>`, `addCategory(name, kind)`, `renameCategory(id,name)`, `setCategoryActive(id,active)`
  - `paymentTypeAccounts(): Promise<Array<{sdId,name,account}>>`, `setPaymentTypeAccount(sdId, account)`, `accountOfPaymentType(): Promise<Map<string,'cash'|'bank'>>`
  - Routes: `GET /cash/bank-accounts`, `POST /cash/bank-accounts {name}`, `PATCH /cash/bank-accounts/:id {name?, active?}`, same three for `/cash/categories` (`POST {name, kind}`), `GET /cash/payment-types`, `PUT /cash/payment-types/:sdId {account}`.
  - Errors (400): «Введите название», «Неверный вид статьи», «Неверный счёт», 404 «Не найдено».

- [ ] **Step 1: Failing test** — `cash-refs.service.spec.ts`:

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { CashRefsService } from './cash-refs.service.js';

const db = createTestDb();
const refs = new CashRefsService(db);
const seenAt = new Date();

describe('CashRefsService', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.paymentType.createMany({
      data: [
        { sdId: 'd0_1', name: 'Наличный', active: true, raw: {}, seenAt },
        { sdId: 'd0_2', name: 'Перечисление', active: true, raw: {}, seenAt },
        { sdId: 'd0_3', name: 'Терминал', active: true, raw: {}, seenAt },
        { sdId: 'd0_4', name: 'Click', active: true, raw: {}, seenAt },
      ],
    });
  });
  afterAll(() => db.$disconnect());

  it('adds, renames and deactivates bank accounts and статьи, sorted by name', async () => {
    const a = await refs.addBankAccount('  Ипотека банк  ');
    await refs.addBankAccount('Asaka');
    await refs.renameBankAccount(a.id, 'Ипотека банк (сум)');
    await refs.setBankAccountActive(a.id, false);
    expect(await refs.bankAccounts()).toEqual([
      expect.objectContaining({ name: 'Asaka', active: true }),
      expect.objectContaining({ name: 'Ипотека банк (сум)', active: false }),
    ]);
    await refs.addCategory('Транспорт', 'expense');
    await expect(refs.addCategory(' ', 'expense')).rejects.toThrow('Введите название');
    await expect(refs.addCategory('x', 'other')).rejects.toThrow('Неверный вид статьи');
    await expect(refs.renameCategory('nope', 'x')).rejects.toThrow('Не найдено');
    expect((await refs.categories()).map((c) => [c.name, c.kind])).toEqual([['Транспорт', 'expense']]);
  });

  it('defaults payment types by name (only «Перечисление» to bank) and lets the owner change one', async () => {
    expect((await refs.paymentTypeAccounts()).map((p) => [p.name, p.account])).toEqual([
      ['Click', 'cash'], ['Наличный', 'cash'], ['Перечисление', 'bank'], ['Терминал', 'cash'],
    ]);
    await refs.setPaymentTypeAccount('d0_4', 'bank');
    await expect(refs.setPaymentTypeAccount('d0_4', 'card')).rejects.toThrow('Неверный счёт');
    expect((await refs.accountOfPaymentType()).get('d0_4')).toBe('bank');
  });

  it('defaults an unknown payment type to cash', async () => {
    expect((await refs.accountOfPaymentType()).get('d0_4')).toBe('cash');
  });

  it('deactivated category stays on old operations', async () => {
    const c = await refs.addCategory('Аренда', 'expense');
    await refs.setCategoryActive(c.id, false);
    const all = await refs.categories();
    expect(all.find((x) => x.id === c.id)).toMatchObject({ name: 'Аренда', active: false });
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/cash/cash-refs.service.spec.ts` · Expected: FAIL «Cannot find module './cash-refs.service.js'».

- [ ] **Step 3: Implement** — `cash-refs.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export type Account = 'cash' | 'bank';
const ACCOUNTS: Account[] = ['cash', 'bank'];
const KINDS = ['expense', 'income'];
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');
const clean = (name: string) => {
  const n = name?.trim();
  if (!n) throw new BadRequestException('Введите название');
  return n;
};
/** Default page for a Salesdoc payment type: «Перечисление» is bank money, everything else cash (spec §6). */
const defaultAccount = (name: string): Account => (/перечисл/i.test(name) ? 'bank' : 'cash');

/** Bank accounts, статьи and the payment-type → page map. Placeholders the owner fills in later. */
@Injectable()
export class CashRefsService {
  constructor(private readonly prisma: PrismaService) {}

  async bankAccounts() {
    const rows = await this.prisma.bankAccount.findMany({ select: { id: true, name: true, active: true } });
    return rows.sort(byName);
  }
  addBankAccount(name: string) {
    return this.prisma.bankAccount.create({ data: { name: clean(name) } });
  }
  async renameBankAccount(id: string, name: string) {
    const r = await this.prisma.bankAccount.updateMany({ where: { id }, data: { name: clean(name) } });
    if (!r.count) throw new NotFoundException('Не найдено');
  }
  async setBankAccountActive(id: string, active: boolean) {
    const r = await this.prisma.bankAccount.updateMany({ where: { id }, data: { active } });
    if (!r.count) throw new NotFoundException('Не найдено');
  }

  async categories() {
    const rows = await this.prisma.cashCategory.findMany({ select: { id: true, name: true, kind: true, active: true } });
    return rows.sort(byName);
  }
  addCategory(name: string, kind: string) {
    const n = clean(name);
    if (!KINDS.includes(kind)) throw new BadRequestException('Неверный вид статьи');
    return this.prisma.cashCategory.create({ data: { name: n, kind } });
  }
  async renameCategory(id: string, name: string) {
    const r = await this.prisma.cashCategory.updateMany({ where: { id }, data: { name: clean(name) } });
    if (!r.count) throw new NotFoundException('Не найдено');
  }
  async setCategoryActive(id: string, active: boolean) {
    const r = await this.prisma.cashCategory.updateMany({ where: { id }, data: { active } });
    if (!r.count) throw new NotFoundException('Не найдено');
  }

  async paymentTypeAccounts() {
    const [types, set] = await Promise.all([
      this.prisma.paymentType.findMany({ select: { sdId: true, name: true } }),
      this.prisma.paymentTypeAccount.findMany(),
    ]);
    const chosen = new Map(set.map((s) => [s.paymentTypeSdId, s.account as Account]));
    return types.map((t) => ({ sdId: t.sdId, name: t.name, account: chosen.get(t.sdId) ?? defaultAccount(t.name) })).sort(byName);
  }
  async setPaymentTypeAccount(sdId: string, account: string) {
    if (!ACCOUNTS.includes(account as Account)) throw new BadRequestException('Неверный счёт');
    await this.prisma.paymentTypeAccount.upsert({ where: { paymentTypeSdId: sdId }, create: { paymentTypeSdId: sdId, account }, update: { account } });
  }
  async accountOfPaymentType(): Promise<Map<string, Account>> {
    return new Map((await this.paymentTypeAccounts()).map((p) => [p.sdId, p.account]));
  }
}
```

`cash.controller.ts` (refs part):

```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { CashRefsService } from './cash-refs.service.js';

@Controller('cash')
export class CashController {
  constructor(private readonly refs: CashRefsService) {}

  @Get('bank-accounts') bankAccounts() { return this.refs.bankAccounts(); }
  @Post('bank-accounts') addBankAccount(@Body() b: { name?: string }) { return this.refs.addBankAccount(b?.name ?? ''); }
  @Patch('bank-accounts/:id') @HttpCode(204)
  async patchBankAccount(@Param('id') id: string, @Body() b: { name?: string; active?: boolean }) {
    if (b?.name !== undefined) await this.refs.renameBankAccount(id, b.name);
    if (b?.active !== undefined) await this.refs.setBankAccountActive(id, !!b.active);
  }

  @Get('categories') categories() { return this.refs.categories(); }
  @Post('categories') addCategory(@Body() b: { name?: string; kind?: string }) { return this.refs.addCategory(b?.name ?? '', b?.kind ?? ''); }
  @Patch('categories/:id') @HttpCode(204)
  async patchCategory(@Param('id') id: string, @Body() b: { name?: string; active?: boolean }) {
    if (b?.name !== undefined) await this.refs.renameCategory(id, b.name);
    if (b?.active !== undefined) await this.refs.setCategoryActive(id, !!b.active);
  }

  @Get('payment-types') paymentTypes() { return this.refs.paymentTypeAccounts(); }
  @Put('payment-types/:sdId') @HttpCode(204)
  setPaymentType(@Param('sdId') sdId: string, @Body() b: { account?: string }) { return this.refs.setPaymentTypeAccount(sdId, b?.account ?? ''); }
}
```

`cash.module.ts`: `@Module({ controllers: [CashController], providers: [CashRefsService, CashService], exports: [CashRefsService] })` (CashService arrives in Task 3 — register `CashRefsService` only now). Add `CashModule` to `app.module.ts` imports after `SalesModule`.

- [ ] **Step 4: Run** — `npx vitest run src/cash` · Expected: PASS. Add `'/cash/categories'` to the e2e 401 list in `test/app.e2e-spec.ts`; `npx vitest run --config ./vitest.config.e2e.ts` · Expected: 5 passed.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): bank accounts, статьи and payment-type pages for Деньги"`

---

### Task 3: Operations — catalogue, create, edit, cancel, restore

**Files:**
- Create: `apps/api/src/cash/operations.ts`, `apps/api/src/cash/cash.service.ts`, `apps/api/src/cash/cash.service.spec.ts`

**Interfaces:**
- Consumes: `MonthsService.assertOpen(month)`, `monthOf(date)`, `AuditService.record(db, …)`, `DATA_START`, `tashkentDay`.
- Produces:
  - `operations.ts`: `type OpCode`, `type Needs = 'supplier'|'outlet'|'expenseCategory'|'incomeCategory'|'name'|'none'`, `OPERATIONS: Record<OpCode, { direction: 'in'|'out'; accounts: Account[]; needs: Needs; bankTarget?: true }>`, `type CashPage = 'cash-in'|'cash-out'|'bank-in'|'bank-out'`, `PAGES: Record<CashPage,{account,direction}>`, `opsForPage(page): OpCode[]`.
  - `CashInput = { operation: OpCode; account: Account; date: string; amount: number|string; cashboxSdId?: string|null; bankAccountId?: string|null; targetBankAccountId?: string|null; supplierSdId?: string|null; outletSdId?: string|null; categoryId?: string|null; counterpartyName?: string|null; comment?: string|null }`
  - `CashService.create(input, user): Promise<{ id: string; number: string }>`, `update(id, input, user)`, `cancel(id, reason, user)`, `restore(id, user)`, `get(id)`.
  - `number(seq) => 'ДД-' + String(seq).padStart(6,'0')`.
  - Errors (400 unless noted): «Неверная операция», «Операция недоступна для этого счёта», «Неверная дата», «Дата раньше 01.09.2026», «Дата в будущем», «Сумма должна быть больше нуля», «Сумма: не больше 2 знаков после запятой», «Выберите кассу», «Выберите счёт», «Выберите счёт для взноса», «Выберите поставщика», «Выберите покупателя», «Выберите статью», «Укажите кому / от кого», «Поставщик не найден», «Покупатель не найден», «Статья не найдена», «Касса не найдена», «Счёт не найден», «Укажите причину», 409 «Операция уже отменена», 409 «Операция не отменена», 409 «Операция отменена», 409 «Месяц закрыт», 404 «Операция не найдена», 400 «Вид операции не меняется».

- [ ] **Step 1: The catalogue** — `operations.ts`:

```ts
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
export const isOp = (v: unknown): v is OpCode => typeof v === 'string' && v in OPERATIONS;

export type CashPage = 'cash-in' | 'cash-out' | 'bank-in' | 'bank-out';
export const PAGES: Record<CashPage, { account: Account; direction: Direction }> = {
  'cash-in': { account: 'cash', direction: 'in' },
  'cash-out': { account: 'cash', direction: 'out' },
  'bank-in': { account: 'bank', direction: 'in' },
  'bank-out': { account: 'bank', direction: 'out' },
};
export const isPage = (v: unknown): v is CashPage => typeof v === 'string' && v in PAGES;

/** The «Создать» menu of a page. */
export const opsForPage = (page: CashPage): OpCode[] =>
  (Object.keys(OPERATIONS) as OpCode[]).filter((c) => {
    const o = OPERATIONS[c];
    return o.direction === PAGES[page].direction && (o.accounts as readonly Account[]).includes(PAGES[page].account);
  });

export const cashNumber = (seq: number) => `ДД-${String(seq).padStart(6, '0')}`;
```

- [ ] **Step 2: Failing tests** — `cash.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { MonthsService } from '../months/months.service.js';
import { CashRefsService } from './cash-refs.service.js';
import { CashService } from './cash.service.js';
import { opsForPage } from './operations.js';

const db = createTestDb();
const audit = new AuditService(db);
const months = new MonthsService(db, audit);
const refs = new CashRefsService(db);
const cash = new CashService(db, months, audit, refs);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const seenAt = new Date();
let bank = '';
let expenseCat = '';
let incomeCat = '';

beforeEach(async () => {
  await truncateAll(db);
  await db.user.create({ data: { id: 'u1', login: 'sardor', name: 'Сардорбек', passwordHash: 'x' } });
  await db.cashbox.create({ data: { sdId: '1', name: 'Основная касса', active: true, raw: {}, seenAt } });
  await db.supplier.create({ data: { sdId: '1', name: 'Основной поставщик', active: true, raw: {}, seenAt } });
  await db.outlet.create({ data: { sdId: 'o1', name: 'Агентлар (черноголовка)', active: true, raw: {}, seenAt } });
  bank = (await refs.addBankAccount('Основной счёт')).id;
  expenseCat = (await refs.addCategory('Транспорт', 'expense')).id;
  incomeCat = (await refs.addCategory('Прочие доходы', 'income')).id;
});
afterAll(() => db.$disconnect());

const pay = { operation: 'supplier_payment', account: 'bank', bankAccountId: bank, date: '2026-10-02', amount: 10500000, supplierSdId: '1' } as const;

describe('CashService — create', () => {
  it('builds each page menu from the catalogue', () => {
    expect(opsForPage('cash-out')).toContain('cash_to_bank');
    expect(opsForPage('bank-out')).not.toContain('cash_to_bank');
    expect(opsForPage('bank-in')).toEqual(['from_buyer', 'supplier_refund', 'employee_loan_return', 'credit_received', 'other_income']);
  });

  it('creates a numbered supplier payment and records it', async () => {
    const a = await cash.create({ ...pay, bankAccountId: bank }, user);
    const b = await cash.create({ operation: 'expense', account: 'cash', cashboxSdId: '1', date: '2026-10-03', amount: '30800.5', categoryId: expenseCat, comment: 'услуга банка' }, user);
    expect([a.number, b.number]).toEqual(['ДД-000001', 'ДД-000002']);
    const op = await cash.get(a.id);
    expect(op).toMatchObject({ number: 'ДД-000001', operation: 'supplier_payment', amount: '10500000.00', supplierName: 'Основной поставщик', bankAccountName: 'Основной счёт', cancelled: null, monthOpen: true });
    const [entry] = await audit.list({ target: a.id });
    expect(entry).toMatchObject({ action: 'cash.create', userName: 'Сардорбек' });
  });

  it('asks for the one field each operation needs', async () => {
    const base = { account: 'cash', cashboxSdId: '1', date: '2026-10-02', amount: 1 } as const;
    await expect(cash.create({ ...base, operation: 'supplier_payment' }, user)).rejects.toThrow('Выберите поставщика');
    await expect(cash.create({ ...base, operation: 'buyer_refund' }, user)).rejects.toThrow('Выберите покупателя');
    await expect(cash.create({ ...base, operation: 'expense' }, user)).rejects.toThrow('Выберите статью');
    await expect(cash.create({ ...base, operation: 'expense', categoryId: incomeCat }, user)).rejects.toThrow('Выберите статью');
    await expect(cash.create({ ...base, operation: 'salary', counterpartyName: '  ' }, user)).rejects.toThrow('Укажите кому / от кого');
    await expect(cash.create({ ...base, operation: 'cash_to_bank' }, user)).rejects.toThrow('Выберите счёт для взноса');
    await expect(cash.create({ ...base, operation: 'supplier_payment', supplierSdId: 'zz' }, user)).rejects.toThrow('Поставщик не найден');
    await expect(cash.create({ ...base, operation: 'from_buyer', outletSdId: 'zz' }, user)).rejects.toThrow('Покупатель не найден');
    await expect(cash.create({ ...base, operation: 'payroll' }, user)).resolves.toMatchObject({ number: 'ДД-000001' });
  });

  it('checks account, date and amount', async () => {
    await expect(cash.create({ ...pay, operation: 'nope' as never }, user)).rejects.toThrow('Неверная операция');
    await expect(cash.create({ ...pay, operation: 'cash_to_bank', account: 'bank' }, user)).rejects.toThrow('Операция недоступна для этого счёта');
    await expect(cash.create({ ...pay, bankAccountId: null }, user)).rejects.toThrow('Выберите счёт');
    await expect(cash.create({ ...pay, account: 'cash', bankAccountId: null }, user)).rejects.toThrow('Выберите кассу');
    await expect(cash.create({ ...pay, account: 'cash', bankAccountId: null, cashboxSdId: 'zz' }, user)).rejects.toThrow('Касса не найдена');
    await expect(cash.create({ ...pay, date: '2026-02-31' }, user)).rejects.toThrow('Неверная дата');
    await expect(cash.create({ ...pay, date: '2026-08-31' }, user)).rejects.toThrow('Дата раньше 01.09.2026');
    await expect(cash.create({ ...pay, date: '2099-01-01' }, user)).rejects.toThrow('Дата в будущем');
    await expect(cash.create({ ...pay, amount: 0 }, user)).rejects.toThrow('Сумма должна быть больше нуля');
    await expect(cash.create({ ...pay, amount: '1.234' }, user)).rejects.toThrow('Сумма: не больше 2 знаков после запятой');
  });

  it('refuses a closed month', async () => {
    await months.setClosed('2026-09', true, user);
    await expect(cash.create({ ...pay, date: '2026-09-30' }, user)).rejects.toThrow('Месяц закрыт');
  });
});

describe('CashService — edit, cancel, restore', () => {
  it('edits fields but not the operation, with before/after in history', async () => {
    const { id } = await cash.create({ ...pay, bankAccountId: bank }, user);
    await cash.update(id, { ...pay, bankAccountId: bank, amount: 12000000, comment: 'исправлено' }, user);
    expect(await cash.get(id)).toMatchObject({ amount: '12000000.00', comment: 'исправлено' });
    await expect(cash.update(id, { ...pay, bankAccountId: bank, operation: 'expense', categoryId: expenseCat }, user)).rejects.toThrow('Вид операции не меняется');
    const [edit] = await audit.list({ target: id });
    expect(edit).toMatchObject({ action: 'cash.edit' });
    expect(edit.before).toMatchObject({ amount: '10500000.00' });
    expect(edit.after).toMatchObject({ amount: '12000000.00' });
  });

  it('refuses moving into a closed month', async () => {
    const { id } = await cash.create({ ...pay, bankAccountId: bank }, user);
    await months.setClosed('2026-09', true, user);
    await expect(cash.update(id, { ...pay, bankAccountId: bank, date: '2026-09-15' }, user)).rejects.toThrow('Месяц закрыт');
  });

  it('cancels with a reason, refuses edits while cancelled, restores', async () => {
    const { id } = await cash.create({ ...pay, bankAccountId: bank }, user);
    await expect(cash.cancel(id, ' ', user)).rejects.toThrow('Укажите причину');
    await cash.cancel(id, 'дубль', user);
    expect((await cash.get(id)).cancelled).toMatchObject({ by: 'Сардорбек', reason: 'дубль' });
    await expect(cash.cancel(id, 'ещё', user)).rejects.toBeInstanceOf(ConflictException);
    await expect(cash.update(id, { ...pay, bankAccountId: bank }, user)).rejects.toThrow('Операция отменена');
    await cash.restore(id, user);
    expect((await cash.get(id)).cancelled).toBeNull();
    await expect(cash.restore(id, user)).rejects.toThrow('Операция не отменена');
    expect((await audit.list({ target: id })).map((e) => e.action)).toEqual(['cash.restore', 'cash.cancel', 'cash.create']);
  });

  it('refuses cancel and restore in a closed month, and an unknown id', async () => {
    const { id } = await cash.create({ ...pay, bankAccountId: bank }, user);
    await months.setClosed('2026-10', true, user);
    await expect(cash.cancel(id, 'x', user)).rejects.toThrow('Месяц закрыт');
    await expect(cash.get('nope')).rejects.toThrow('Операция не найдена');
  });
});
```

(These tests need the system date ≥ 2026-10-03; the project's clock is already past it.)

- [ ] **Step 3: Run** — `npx vitest run src/cash/cash.service.spec.ts` · Expected: FAIL, module not found.

- [ ] **Step 4: Implement** — `cash.service.ts` (Task 4 adds `list`, `history`, `formOptions` to this class):

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';
import { MonthsService, monthOf } from '../months/months.service.js';
import { tashkentDay } from '../sync/salesdoc-date.js';
import { DATA_START } from '../sync/window.js';
import { CashRefsService, type Account } from './cash-refs.service.js';
import { OPERATIONS, cashNumber, isOp, type OpCode } from './operations.js';

export interface CashInput {
  operation: OpCode;
  account: Account;
  date: string;
  amount: number | string;
  cashboxSdId?: string | null;
  bankAccountId?: string | null;
  targetBankAccountId?: string | null;
  supplierSdId?: string | null;
  outletSdId?: string | null;
  categoryId?: string | null;
  counterpartyName?: string | null;
  comment?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: string) => DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const s2 = (v: Prisma.Decimal) => v.toFixed(2);
const blank = (v?: string | null) => (v?.trim() ? v.trim() : null);

type Row = Prisma.CashOperationGetPayload<object>;
const snapshot = (o: Pick<Row, 'date' | 'amount' | 'account' | 'cashboxSdId' | 'bankAccountId' | 'supplierSdId' | 'outletSdId' | 'categoryId' | 'counterpartyName' | 'comment'>) => ({
  date: o.date.toISOString().slice(0, 10),
  amount: s2(new Prisma.Decimal(o.amount)),
  account: o.account,
  cashboxSdId: o.cashboxSdId,
  bankAccountId: o.bankAccountId,
  supplierSdId: o.supplierSdId,
  outletSdId: o.outletSdId,
  categoryId: o.categoryId,
  counterpartyName: o.counterpartyName,
  comment: o.comment,
});

/** Cash and bank operations entered in our app (spec §3–4). */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly months: MonthsService,
    private readonly audit: AuditService,
    private readonly refs: CashRefsService,
  ) {}

  /** Validates and normalises an input; throws the first problem, in form order. */
  private async clean(input: CashInput) {
    if (!isOp(input.operation)) throw new BadRequestException('Неверная операция');
    const def = OPERATIONS[input.operation];
    if (!(def.accounts as readonly string[]).includes(input.account)) throw new BadRequestException('Операция недоступна для этого счёта');
    if (!isDay(input.date ?? '')) throw new BadRequestException('Неверная дата');
    if (input.date < DATA_START) throw new BadRequestException('Дата раньше 01.09.2026');
    if (input.date > tashkentDay(new Date())) throw new BadRequestException('Дата в будущем');
    const amount = new Prisma.Decimal(Number.isFinite(Number(input.amount)) ? String(input.amount) : '0');
    if (!amount.gt(0)) throw new BadRequestException('Сумма должна быть больше нуля');
    if (amount.decimalPlaces() > 2) throw new BadRequestException('Сумма: не больше 2 знаков после запятой');

    let cashboxSdId: string | null = null;
    let bankAccountId: string | null = null;
    if (input.account === 'cash') {
      cashboxSdId = blank(input.cashboxSdId);
      if (!cashboxSdId) throw new BadRequestException('Выберите кассу');
      if (!(await this.prisma.cashbox.findUnique({ where: { sdId: cashboxSdId } }))) throw new BadRequestException('Касса не найдена');
      if ('bankTarget' in def) {
        bankAccountId = blank(input.targetBankAccountId ?? input.bankAccountId);
        if (!bankAccountId) throw new BadRequestException('Выберите счёт для взноса');
      }
    } else {
      bankAccountId = blank(input.bankAccountId);
      if (!bankAccountId) throw new BadRequestException('Выберите счёт');
    }
    if (bankAccountId && !(await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } }))) throw new BadRequestException('Счёт не найден');

    const out = { supplierSdId: null as string | null, outletSdId: null as string | null, categoryId: null as string | null, counterpartyName: null as string | null };
    switch (def.needs) {
      case 'supplier':
        out.supplierSdId = blank(input.supplierSdId);
        if (!out.supplierSdId) throw new BadRequestException('Выберите поставщика');
        if (!(await this.prisma.supplier.findUnique({ where: { sdId: out.supplierSdId } }))) throw new BadRequestException('Поставщик не найден');
        break;
      case 'outlet':
        out.outletSdId = blank(input.outletSdId);
        if (!out.outletSdId) throw new BadRequestException('Выберите покупателя');
        if (!(await this.prisma.outlet.findUnique({ where: { sdId: out.outletSdId } }))) throw new BadRequestException('Покупатель не найден');
        break;
      case 'expenseCategory':
      case 'incomeCategory': {
        out.categoryId = blank(input.categoryId);
        const cat = out.categoryId ? await this.prisma.cashCategory.findUnique({ where: { id: out.categoryId } }) : null;
        if (!cat || cat.kind !== (def.needs === 'expenseCategory' ? 'expense' : 'income')) throw new BadRequestException(out.categoryId && !cat ? 'Статья не найдена' : 'Выберите статью');
        break;
      }
      case 'name':
        out.counterpartyName = blank(input.counterpartyName);
        if (!out.counterpartyName) throw new BadRequestException('Укажите кому / от кого');
        break;
    }
    return {
      operation: input.operation,
      direction: def.direction,
      account: input.account,
      cashboxSdId,
      bankAccountId,
      date: new Date(`${input.date}T00:00:00Z`),
      amount,
      comment: blank(input.comment),
      ...out,
    };
  }

  private async find(id: string) {
    const o = await this.prisma.cashOperation.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Операция не найдена');
    return o;
  }

  async create(input: CashInput, user: AuthUser): Promise<{ id: string; number: string }> {
    const data = await this.clean(input);
    await this.months.assertOpen(monthOf(data.date));
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.cashOperation.create({ data: { ...data, createdById: user.id, createdByName: user.name } });
      await this.audit.record(tx, { user, action: 'cash.create', target: o.id, after: snapshot(o) });
      return { id: o.id, number: cashNumber(o.seq) };
    });
  }

  async update(id: string, input: CashInput, user: AuthUser): Promise<void> {
    const o = await this.find(id);
    if (o.cancelledAt) throw new ConflictException('Операция отменена');
    if (input.operation !== o.operation) throw new BadRequestException('Вид операции не меняется');
    const data = await this.clean(input);
    await this.months.assertOpen(monthOf(o.date));
    await this.months.assertOpen(monthOf(data.date));
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.cashOperation.update({ where: { id }, data });
      await this.audit.record(tx, { user, action: 'cash.edit', target: id, before: snapshot(o), after: snapshot(n) });
    });
  }

  async cancel(id: string, reason: string, user: AuthUser): Promise<void> {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('Укажите причину');
    const o = await this.find(id);
    await this.months.assertOpen(monthOf(o.date));
    await this.prisma.$transaction(async (tx) => {
      // Guarded update: two cancels at once — the second matches nothing.
      const r = await tx.cashOperation.updateMany({
        where: { id, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelledById: user.id, cancelledByName: user.name, cancelReason: why },
      });
      if (!r.count) throw new ConflictException('Операция уже отменена');
      await this.audit.record(tx, { user, action: 'cash.cancel', target: id, reason: why });
    });
  }

  async restore(id: string, user: AuthUser): Promise<void> {
    const o = await this.find(id);
    await this.months.assertOpen(monthOf(o.date));
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.cashOperation.updateMany({
        where: { id, cancelledAt: { not: null } },
        data: { cancelledAt: null, cancelledById: null, cancelledByName: null, cancelReason: null },
      });
      if (!r.count) throw new ConflictException('Операция не отменена');
      await this.audit.record(tx, { user, action: 'cash.restore', target: id });
    });
  }

  async get(id: string) {
    const o = await this.find(id);
    const [names] = await Promise.all([this.names([o])]);
    const month = await this.prisma.month.findUnique({ where: { month: monthOf(o.date) } });
    return { ...this.view(o, names), monthOpen: !month?.closed };
  }

  /** Display names for a batch of operations. */
  private async names(ops: Row[]) {
    const ids = (k: keyof Row) => [...new Set(ops.map((o) => o[k]).filter((v): v is string => typeof v === 'string'))];
    const [sup, out, cat, box, acc] = await Promise.all([
      this.prisma.supplier.findMany({ where: { sdId: { in: ids('supplierSdId') } }, select: { sdId: true, name: true } }),
      this.prisma.outlet.findMany({ where: { sdId: { in: ids('outletSdId') } }, select: { sdId: true, name: true } }),
      this.prisma.cashCategory.findMany({ where: { id: { in: ids('categoryId') } }, select: { id: true, name: true } }),
      this.prisma.cashbox.findMany({ where: { sdId: { in: ids('cashboxSdId') } }, select: { sdId: true, name: true } }),
      this.prisma.bankAccount.findMany({ where: { id: { in: ids('bankAccountId') } }, select: { id: true, name: true } }),
    ]);
    return {
      supplier: new Map(sup.map((x) => [x.sdId, x.name])),
      outlet: new Map(out.map((x) => [x.sdId, x.name])),
      category: new Map(cat.map((x) => [x.id, x.name])),
      cashbox: new Map(box.map((x) => [x.sdId, x.name])),
      bank: new Map(acc.map((x) => [x.id, x.name])),
    };
  }

  private view(o: Row, n: Awaited<ReturnType<CashService['names']>>) {
    const party =
      (o.supplierSdId && n.supplier.get(o.supplierSdId)) ||
      (o.outletSdId && n.outlet.get(o.outletSdId)) ||
      (o.categoryId && n.category.get(o.categoryId)) ||
      o.counterpartyName ||
      null;
    return {
      id: o.id,
      number: cashNumber(o.seq),
      source: 'app' as const,
      operation: o.operation,
      direction: o.direction,
      account: o.account,
      date: o.date.toISOString().slice(0, 10),
      amount: s2(o.amount),
      cashboxSdId: o.cashboxSdId,
      cashboxName: o.cashboxSdId ? (n.cashbox.get(o.cashboxSdId) ?? o.cashboxSdId) : null,
      bankAccountId: o.bankAccountId,
      bankAccountName: o.bankAccountId ? (n.bank.get(o.bankAccountId) ?? null) : null,
      supplierSdId: o.supplierSdId,
      supplierName: o.supplierSdId ? (n.supplier.get(o.supplierSdId) ?? o.supplierSdId) : null,
      outletSdId: o.outletSdId,
      categoryId: o.categoryId,
      counterpartyName: o.counterpartyName,
      party,
      comment: o.comment,
      createdByName: o.createdByName,
      cancelled: o.cancelledAt ? { by: o.cancelledByName ?? '', at: o.cancelledAt.toISOString(), reason: o.cancelReason ?? '' } : null,
    };
  }
}
```

Register `CashService` in `cash.module.ts` (`providers: [CashRefsService, CashService]`, import nothing — `MonthsModule` and `DatabaseModule` are global).

- [ ] **Step 5: Run** — `npx vitest run src/cash` · Expected: all PASS. `npx tsc --noEmit -p tsconfig.json` · Expected: clean.

- [ ] **Step 6: Commit** — `git commit -m "feat(api): cash operations — create, edit, cancel, restore with history"`

---

### Task 4: Lists per page, Salesdoc buyer payments, history, form options, routes

**Files:**
- Modify: `apps/api/src/cash/cash.service.ts`, `apps/api/src/cash/cash.controller.ts`
- Create: `apps/api/src/audit/audit.controller.ts` (registered in `months.module.ts`, which already provides `AuditService`)
- Test: `apps/api/src/cash/cash-list.spec.ts`

**Interfaces:**
- Consumes: Task 2 `accountOfPaymentType()`, Task 3 `view()`, `names()`, `PAGES`, `opsForPage`.
- Produces:
  - `CashService.list(page: CashPage, p: Period, q: { operation?: string; box?: string; search?: string; includeCancelled?: boolean }) → { total: string; rows: CashRow[]; filters: { operations: string[]; boxes: Array<{id,name}> } }` where `CashRow = view(o) & { mirrored?: true }` for app rows or `{ id: 'sd:'+sdId, number: sdId, source: 'salesdoc', operation: 'from_buyer', date, amount, party: outletName, comment, cashboxName, cancelled: null }` for Salesdoc payments.
  - `CashService.history(page)` → `AuditService.list({ actionPrefix: 'cash.', targets })` for operations on that page.
  - `CashService.formOptions() → { cashboxes, bankAccounts (active), suppliers, outlets, expenseCategories (active), incomeCategories (active) }` each `{id,name}`.
  - Routes: `GET /cash/pages/:page?from&to&operation&box&search&includeCancelled`, `GET /cash/pages/:page/history`, `GET /cash/form-options`, `GET /cash/operations/:id`, `GET /cash/operations/:id/history`, `POST /cash/operations` (201 `{id, number}`), `PUT /cash/operations/:id`, `POST /cash/operations/:id/cancel {reason}`, `POST /cash/operations/:id/restore`; `GET /audit?actionPrefix&target` (prefix limited to `purchase.`, `month.`, `cash.`).
  - Unknown page → 404 «Страница не найдена».

- [ ] **Step 1: Failing tests** — `cash-list.spec.ts` (same setup block as `cash.service.spec.ts`, plus payment types and payments):

```ts
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { MonthsService } from '../months/months.service.js';
import { parsePeriod } from '../settlements/period.js';
import { CashRefsService } from './cash-refs.service.js';
import { CashService } from './cash.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const months = new MonthsService(db, audit);
const refs = new CashRefsService(db);
const cash = new CashService(db, months, audit, refs);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const seenAt = new Date();
const oct = parsePeriod('2026-10-01', '2026-10-31', '2026-10-06');
let bank = '';

beforeEach(async () => {
  await truncateAll(db);
  await db.cashbox.create({ data: { sdId: '1', name: 'Основная касса', active: true, raw: {}, seenAt } });
  await db.supplier.create({ data: { sdId: '1', name: 'AQUA-PRODUCTS', active: true, raw: {}, seenAt } });
  await db.outlet.create({ data: { sdId: 'o1', name: 'Агентлар (черноголовка)', active: true, raw: {}, seenAt } });
  await db.paymentType.createMany({ data: [
    { sdId: 'd0_1', name: 'Наличный', active: true, raw: {}, seenAt },
    { sdId: 'd0_2', name: 'Перечисление', active: true, raw: {}, seenAt },
  ] });
  await db.payment.createMany({ data: [
    { sdId: 'p1', paymentDate: new Date('2026-10-02T10:00:00Z'), amount: 9472000, transactionType: 3, paymentTypeSdId: 'd0_1', outletSdId: 'o1', cashboxSdId: '1', raw: {}, seenAt },
    { sdId: 'p2', paymentDate: new Date('2026-10-03T10:00:00Z'), amount: 1488000, transactionType: 3, paymentTypeSdId: 'd0_2', outletSdId: 'o1', cashboxSdId: '1', raw: {}, seenAt },
    { sdId: 'p9', paymentDate: new Date('2026-10-03T10:00:00Z'), amount: -1488000, transactionType: 9, paymentTypeSdId: 'd0_2', outletSdId: 'o1', cashboxSdId: '1', raw: {}, seenAt },
  ] });
  bank = (await refs.addBankAccount('Основной счёт')).id;
});
afterAll(() => db.$disconnect());

describe('CashService — pages', () => {
  it('puts Salesdoc buyer payments on cash or bank by payment type, read-only', async () => {
    const cashIn = await cash.list('cash-in', oct, {});
    expect(cashIn.rows.map((r) => [r.source, r.number, r.operation, r.party, r.amount])).toEqual([['salesdoc', 'p1', 'from_buyer', 'Агентлар (черноголовка)', '9472000.00']]);
    const bankIn = await cash.list('bank-in', oct, {});
    expect(bankIn.rows.map((r) => r.number)).toEqual(['p2']);
    expect(bankIn.total).toBe('1488000.00');
  });

  it('cash-to-bank shows on both pages and cancels on both', async () => {
    const { id } = await cash.create({ operation: 'cash_to_bank', account: 'cash', cashboxSdId: '1', targetBankAccountId: bank, date: '2026-10-04', amount: 79153000 }, user);
    expect((await cash.list('cash-out', oct, {})).total).toBe('79153000.00');
    const bankIn = await cash.list('bank-in', oct, {});
    expect(bankIn.rows.find((r) => r.id === id)).toMatchObject({ mirrored: true, operation: 'cash_to_bank' });
    expect(bankIn.total).toBe('80641000.00');
    await cash.cancel(id, 'ошибка', user);
    expect((await cash.list('cash-out', oct, {})).total).toBe('0.00');
    expect((await cash.list('bank-in', oct, {})).total).toBe('1488000.00');
  });

  it('cancelled rows stay listed but do not count', async () => {
    const a = await cash.create({ operation: 'supplier_payment', account: 'bank', bankAccountId: bank, date: '2026-10-02', amount: 100, supplierSdId: '1' }, user);
    await cash.create({ operation: 'supplier_payment', account: 'bank', bankAccountId: bank, date: '2026-10-03', amount: 50, supplierSdId: '1', comment: 'аванс' }, user);
    await cash.cancel(a.id, 'дубль', user);
    expect((await cash.list('bank-out', oct, {})).rows.map((r) => r.amount)).toEqual(['50.00']);
    const all = await cash.list('bank-out', oct, { includeCancelled: true });
    expect(all.rows.map((r) => [r.amount, !!r.cancelled])).toEqual([['50.00', false], ['100.00', true]]);
    expect(all.total).toBe('50.00');
  });

  it('filters by operation, box and search (number, party, comment), newest first', async () => {
    await cash.create({ operation: 'supplier_payment', account: 'cash', cashboxSdId: '1', date: '2026-10-02', amount: 10, supplierSdId: '1' }, user);
    await cash.create({ operation: 'salary', account: 'cash', cashboxSdId: '1', date: '2026-10-03', amount: 20, counterpartyName: 'Туланов Достонбек', comment: 'узига' }, user);
    expect((await cash.list('cash-out', oct, { operation: 'salary' })).rows.map((r) => r.amount)).toEqual(['20.00']);
    expect((await cash.list('cash-out', oct, { search: 'aqua' })).rows.map((r) => r.amount)).toEqual(['10.00']);
    expect((await cash.list('cash-out', oct, { search: 'узига' })).rows.map((r) => r.amount)).toEqual(['20.00']);
    expect((await cash.list('cash-out', oct, { search: 'ДД-000001' })).rows.map((r) => r.amount)).toEqual(['10.00']);
    expect((await cash.list('cash-out', oct, { box: 'zz' })).rows).toEqual([]);
    expect((await cash.list('cash-out', oct, {})).rows.map((r) => r.date)).toEqual(['2026-10-03', '2026-10-02']);
  });

  it('lists the history of one page only', async () => {
    const a = await cash.create({ operation: 'salary', account: 'cash', cashboxSdId: '1', date: '2026-10-02', amount: 20, counterpartyName: 'Шоядбек' }, user);
    await cash.create({ operation: 'supplier_payment', account: 'bank', bankAccountId: bank, date: '2026-10-02', amount: 10, supplierSdId: '1' }, user);
    expect((await cash.history('cash-out')).map((e) => e.target)).toEqual([a.id]);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/cash/cash-list.spec.ts` · Expected: FAIL, `cash.list is not a function`.

- [ ] **Step 3: Implement** — add to `CashService` (import `type Period` from `../settlements/period.js`, `PAGES`, `opsForPage`, `type CashPage` from `./operations.js`):

```ts
  private async pageRows(page: CashPage, where: Prisma.CashOperationWhereInput) {
    const { account, direction } = PAGES[page];
    // A cash-to-bank deposit is also an incoming on the receiving bank account.
    const mirror = page === 'bank-in' ? [{ operation: 'cash_to_bank', ...where }] : [];
    return this.prisma.cashOperation.findMany({
      where: { OR: [{ account, direction, ...where }, ...mirror] },
      orderBy: [{ date: 'desc' }, { seq: 'desc' }],
    });
  }

  async list(page: CashPage, p: Period, q: { operation?: string; box?: string; search?: string; includeCancelled?: boolean } = {}) {
    const { account, direction } = PAGES[page];
    const ops = await this.pageRows(page, {
      date: { gte: p.from, lt: p.toExclusive },
      ...(q.includeCancelled ? {} : { cancelledAt: null }),
    });
    const n = await this.names(ops);
    let rows: Array<ReturnType<CashService['view']> & { mirrored?: true }> = ops.map((o) => ({
      ...this.view(o, n),
      ...(page === 'bank-in' && o.operation === 'cash_to_bank' ? { mirrored: true as const } : {}),
    }));

    if (direction === 'in' && (!q.operation || q.operation === 'from_buyer')) {
      const accountOf = await this.refs.accountOfPaymentType();
      const payments = await this.prisma.payment.findMany({
        where: { transactionType: 3, paymentDate: { gte: p.from, lt: p.toExclusive } },
        orderBy: [{ paymentDate: 'desc' }, { sdId: 'desc' }],
      });
      const mine = payments.filter((x) => (accountOf.get(x.paymentTypeSdId ?? '') ?? 'cash') === account);
      const outlets = new Map((await this.prisma.outlet.findMany({ where: { sdId: { in: mine.map((x) => x.outletSdId).filter((v): v is string => !!v) } }, select: { sdId: true, name: true } })).map((x) => [x.sdId, x.name]));
      const boxes = new Map((await this.prisma.cashbox.findMany({ select: { sdId: true, name: true } })).map((x) => [x.sdId, x.name]));
      rows = rows.concat(
        mine.map((x) => ({
          id: `sd:${x.sdId}`,
          number: x.sdId,
          source: 'salesdoc' as never,
          operation: 'from_buyer',
          direction: 'in',
          account,
          date: x.paymentDate.toISOString().slice(0, 10),
          amount: s2(x.amount),
          cashboxSdId: x.cashboxSdId,
          cashboxName: x.cashboxSdId ? (boxes.get(x.cashboxSdId) ?? x.cashboxSdId) : null,
          bankAccountId: null,
          bankAccountName: null,
          supplierSdId: null,
          supplierName: null,
          outletSdId: x.outletSdId,
          categoryId: null,
          counterpartyName: null,
          party: x.outletSdId ? (outlets.get(x.outletSdId) ?? x.outletSdId) : null,
          comment: x.comment,
          createdByName: '',
          cancelled: null,
        })),
      );
    }

    const needle = q.search?.trim().toLowerCase();
    rows = rows
      .filter((r) => !q.operation || r.operation === q.operation)
      .filter((r) => !q.box || r.cashboxSdId === q.box || r.bankAccountId === q.box)
      .filter((r) => !needle || [r.number, r.party, r.comment].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
    const total = rows.filter((r) => !r.cancelled).reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0));
    const boxes =
      account === 'cash'
        ? (await this.prisma.cashbox.findMany({ select: { sdId: true, name: true } })).map((b) => ({ id: b.sdId, name: b.name }))
        : (await this.refs.bankAccounts()).map((b) => ({ id: b.id, name: b.name }));
    return { total: s2(total), rows, filters: { operations: opsForPage(page), boxes } };
  }

  async history(page: CashPage) {
    const ids = (await this.pageRows(page, {})).map((o) => o.id);
    return this.audit.list({ actionPrefix: 'cash.', targets: ids });
  }

  historyOf(id: string) {
    return this.audit.list({ target: id });
  }

  async formOptions() {
    const pick = { select: { sdId: true, name: true } } as const;
    const [boxes, suppliers, outlets, banks, cats] = await Promise.all([
      this.prisma.cashbox.findMany(pick),
      this.prisma.supplier.findMany(pick),
      this.prisma.outlet.findMany({ ...pick, where: { active: true } }),
      this.refs.bankAccounts(),
      this.refs.categories(),
    ]);
    const idName = (xs: Array<{ sdId: string; name: string }>) => xs.map((x) => ({ id: x.sdId, name: x.name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return {
      cashboxes: idName(boxes),
      bankAccounts: banks.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name })),
      suppliers: idName(suppliers),
      outlets: idName(outlets),
      expenseCategories: cats.filter((c) => c.active && c.kind === 'expense').map((c) => ({ id: c.id, name: c.name })),
      incomeCategories: cats.filter((c) => c.active && c.kind === 'income').map((c) => ({ id: c.id, name: c.name })),
    };
  }
```

(Type note: declare `source: 'app' | 'salesdoc'` in `view()`'s return instead of `'app' as const` so the Salesdoc rows need no cast; drop the `as never`.)

Controller additions (`cash.controller.ts`, inject `CashService` too; import `parsePeriod`, `isPage`, `CurrentUser`, `AuthUser`, `NotFoundException`):

```ts
  private page(page: string) {
    if (!isPage(page)) throw new NotFoundException('Страница не найдена');
    return page;
  }

  @Get('pages/:page')
  list(@Param('page') page: string, @Query('from') from?: string, @Query('to') to?: string, @Query('operation') operation?: string, @Query('box') box?: string, @Query('search') search?: string, @Query('includeCancelled') includeCancelled?: string) {
    return this.cash.list(this.page(page), parsePeriod(from, to), { operation: operation || undefined, box: box || undefined, search: search?.trim() || undefined, includeCancelled: includeCancelled === 'true' });
  }
  @Get('pages/:page/history') pageHistory(@Param('page') page: string) { return this.cash.history(this.page(page)); }
  @Get('form-options') formOptions() { return this.cash.formOptions(); }
  @Get('operations/:id') get(@Param('id') id: string) { return this.cash.get(id); }
  @Get('operations/:id/history') opHistory(@Param('id') id: string) { return this.cash.historyOf(id); }
  @Post('operations') create(@Body() b: CashInput, @CurrentUser() user: AuthUser) { return this.cash.create(b ?? ({} as CashInput), user); }
  @Put('operations/:id') @HttpCode(204) update(@Param('id') id: string, @Body() b: CashInput, @CurrentUser() user: AuthUser) { return this.cash.update(id, b ?? ({} as CashInput), user); }
  @Post('operations/:id/cancel') @HttpCode(204) cancel(@Param('id') id: string, @Body() b: { reason?: string }, @CurrentUser() user: AuthUser) { return this.cash.cancel(id, b?.reason ?? '', user); }
  @Post('operations/:id/restore') @HttpCode(204) restore(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.cash.restore(id, user); }
```

`audit.controller.ts`:

```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';

const PREFIXES = ['purchase.', 'month.', 'cash.'];

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query('actionPrefix') actionPrefix?: string, @Query('target') target?: string) {
    if (!actionPrefix || !PREFIXES.includes(actionPrefix)) throw new BadRequestException('Неверный раздел истории');
    return this.audit.list({ actionPrefix, target: target || undefined });
  }
}
```

Add `controllers: [MonthsController, AuditController]` in `months.module.ts`. Add `'/cash/pages/cash-in'` and `'/audit?actionPrefix=cash.'` to the e2e 401 list.

- [ ] **Step 4: Run** — `npx vitest run src/cash` and `npx vitest run --config ./vitest.config.e2e.ts` · Expected: all PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): Деньги pages with Salesdoc buyer payments, history per page, audit endpoint"`

---

### Task 5: Supplier «Оплачено»

**Files:**
- Modify: `apps/api/src/settlements/settlements.service.ts` (`supplierStatement`, `suppliers`)
- Test: `apps/api/src/settlements/settlements.service.spec.ts`

**Interfaces:**
- Consumes: `CashOperation` rows with `operation in ('supplier_payment','supplier_refund')`, `cancelledAt IS NULL`.
- Produces: `suppliers()` rows keep `{ sdId, name, opening, received, paid, debt }` with `paid` real; `supplierStatement()` rows gain `kind: 'payment'` entries (amount = paid, negative for a refund) and `paid` real; balance = opening + received − paid (statement sign: we owe positive).

- [ ] **Step 1: Failing test** — append to the suppliers `describe` in `settlements.service.spec.ts`:

```ts
  it('counts supplier payments and refunds as paid, ignores cancelled payments', async () => {
    for (const [sdId, day, total] of [['a', '2026-09-02', 1000], ['b', '2026-09-10', 500]] as const) {
      await db.purchase.create({ data: { sdId, date: new Date(`${day}T09:00:00Z`), total, supplierSdId: '1', raw: {}, seenAt } });
    }
    const op = (date: string, amount: number, operation: string, cancelled = false) =>
      db.cashOperation.create({ data: { direction: operation === 'supplier_refund' ? 'in' : 'out', account: 'cash', cashboxSdId: '1', date: new Date(date), amount, operation, supplierSdId: '1', createdById: 'u1', createdByName: 'x', ...(cancelled ? { cancelledAt: new Date() } : {}) } });
    await op('2026-09-03', 300, 'supplier_payment'); // before the period: in the opening
    await op('2026-09-12', 400, 'supplier_payment');
    await op('2026-09-13', 50, 'supplier_refund');
    await op('2026-09-14', 999, 'supplier_payment', true);
    const p = parsePeriod('2026-09-05', '2026-09-30', '2026-09-29');
    const { rows } = await svc.suppliers(p);
    expect(rows.find((r) => r.sdId === '1')).toMatchObject({ opening: '-700.00', received: '500.00', paid: '350.00', debt: '-850.00' });
    const st = await svc.supplierStatement(p, '1');
    expect(st).toMatchObject({ opening: '700.00', received: '500.00', paid: '350.00', closing: '850.00' });
    expect(st.rows.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ['purchase', '500.00', '1200.00'], ['payment', '400.00', '800.00'], ['payment', '-50.00', '850.00'],
    ]);
  });
```

(The supplier `'1'` exists in that describe's setup; if not, create it: `db.supplier.create({ data: { sdId: '1', name: 'Основной поставщик', active: true, raw: {}, seenAt } })`.)

- [ ] **Step 2: Run** — `npx vitest run src/settlements` · Expected: FAIL, `paid: '0.00'`.

- [ ] **Step 3: Implement** — in `supplierStatement`, after the purchases query:

```ts
    const supplierFilter =
      supplierSdId === NO_SUPPLIER ? { supplierSdId: '__none__' } : supplierSdId ? { supplierSdId } : { supplierSdId: { not: null } };
    const payOps = await this.prisma.cashOperation.findMany({
      where: { operation: { in: ['supplier_payment', 'supplier_refund'] }, cancelledAt: null, date: { gte: new Date(`${p.windowStart}T00:00:00Z`), lt: p.toExclusive }, ...supplierFilter },
      orderBy: [{ date: 'asc' }, { seq: 'asc' }],
    });
    const signed = (o: (typeof payOps)[number]) => (o.operation === 'supplier_refund' ? o.amount.neg() : o.amount);
    const paidBefore = payOps.filter((o) => o.date < p.from).reduce((s, o) => s.plus(signed(o)), new Prisma.Decimal(0));
    const paidIn = payOps.filter((o) => o.date >= p.from);
```

Start `balance` at `opening − paidBefore`, return `opening: s(new Prisma.Decimal(opening ?? 0).minus(paidBefore))`, merge `paidIn` rows into the timeline by date (purchases first on the same day), each payment row `{ kind: 'payment', sdId: cashNumber(o.seq), date: o.date.toISOString(), warehouseName: null, amount: s(signed(o)), balance: s(balance = balance.minus(signed(o))) }`, `paid = Σ signed(paidIn)`, `closing = balance`.

In `suppliers()`, add a second raw query:

```ts
      this.prisma.$queryRaw<Array<{ supplier: string; paid: Dec; paidAll: Dec }>>`
        SELECT "supplierSdId" AS supplier,
          SUM(CASE WHEN date >= ${p.fromDay}::date THEN (CASE WHEN operation = 'supplier_refund' THEN -amount ELSE amount END) ELSE 0 END) AS paid,
          SUM(CASE WHEN operation = 'supplier_refund' THEN -amount ELSE amount END) AS "paidAll"
        FROM "CashOperation"
        WHERE operation IN ('supplier_payment', 'supplier_refund') AND "cancelledAt" IS NULL AND "supplierSdId" IS NOT NULL
          AND date >= ${p.windowStart}::date AND date < ${p.toExclusiveDay}::date
        GROUP BY 1`,
```

and per row: `owedAll = balance − paidAll`, `owedBefore = (balance − received) − (paidAll − paid)`; `opening = −owedBefore`, `paid = paid`, `debt = −owedAll` (zeros printed as `0.00`). Include suppliers that appear only in payments in `ids`.

- [ ] **Step 4: Run** — `npx vitest run src/settlements src/warehouse` · Expected: all PASS (existing supplier expectations unchanged: no cash rows → paid 0).

- [ ] **Step 5: Commit** — `git commit -m "feat(api): supplier «Оплачено» from cash operations"`

---

### Task 6: «История» button on the existing pages

**Files:**
- Create: `apps/web/src/components/app/history-button.tsx`
- Modify: `apps/web/src/app/zakupki/nakladnye/[sdId]/page.tsx`, `apps/web/src/app/zakupki/nakladnye/page.tsx`, `apps/web/src/app/settings/months/page.tsx`, `apps/web/src/components/app/history-list.tsx`, `apps/web/src/i18n/messages.ts`

**Interfaces:**
- Consumes: `HistoryList({ entries, names, linkFor? })`, `GET /audit?actionPrefix=purchase.`, `GET /months/history`, `GET /warehouse/purchases/:sdId/history`.
- Produces: `<HistoryButton label="История" title="История">{server-rendered <HistoryList/>}</HistoryButton>`; `HistoryList` gains `linkFor?: Record<string, string>` (target → href) and `actionLabel` covers `cash.*`.

- [ ] **Step 1: Messages** (ru / uz, after `history.after`): `history.open` «История» / «Tarix»; `history.action.cash.create` «Создана» / «Yaratildi»; `history.action.cash.edit` «Изменена» / «O'zgartirildi»; `history.action.cash.cancel` «Отменена» / «Bekor qilindi»; `history.action.cash.restore` «Восстановлена» / «Tiklandi»; `history.open_document` «Открыть» / «Ochish».

- [ ] **Step 2: Component** — `history-button.tsx`:

```tsx
"use client";

import { HistoryIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** «История» in a page header: opens that page's history (rendered on the server and passed in). */
export function HistoryButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger className={cn(buttonVariants({ variant: "outline" }), "active:scale-95")}>
        <HistoryIcon className="size-4" />
        {label}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>{label}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: `HistoryList`** — add `linkFor` and hide its own heading when inside the dialog: new prop `bare?: boolean` (no `<h2>`), and per entry, when `linkFor?.[e.target]`, render `<Link href={linkFor[e.target]} className="text-xs underline-offset-4 hover:underline">{t("history.open_document")}</Link>` after the action. For `cash.*` entries with `before`/`after`, show the same «Было → Стало» details block using a `CashSnapshot` renderer: date, amount (`formatMoney`), comment.

- [ ] **Step 4: Pages** —
  - Receipt page: remove the inline `<HistoryList …/>` (comment it out with a dated note) and pass `<HistoryButton label={t("history.open")}><HistoryList bare entries=… names=…/></HistoryButton>` into the `PageHeader` children next to `ReceiptActions`.
  - Receipts list: fetch `apiGet<AuditEntry[]>("/audit?actionPrefix=purchase.")` alongside the list; header gets `<HistoryButton>` with `linkFor` = `/zakupki/nakladnye/<target>` for every entry.
  - Months page: remove the inline list (commented), header gets `<HistoryButton>` with the month history.

- [ ] **Step 5: Check** — `cd apps/web && npx tsc --noEmit && npx eslint src` · Expected: clean. Browser (logged in, Supabase data, read-only): open a receipt → «История» opens a dialog listing its entries; the receipts list's «История» lists purchase entries with «Открыть» links; months page likewise; ru/uz; 390 px (dialog fits, no horizontal page scroll). Screenshot each.

- [ ] **Step 6: Commit** — `git commit -m "feat(web): «История» button opens a page's history"`

---

### Task 7: Деньги section — panel, four lists, operation page

**Files:**
- Create: `apps/web/src/lib/dengi-menu.ts`, `apps/web/src/app/dengi/page.tsx`, `apps/web/src/app/dengi/[page]/page.tsx`, `apps/web/src/app/dengi/op/[id]/page.tsx`, `apps/web/src/app/dengi/op-actions.tsx`, `apps/web/src/app/dengi/actions.ts`, `apps/web/src/app/dengi/peremeshcheniya/page.tsx`
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/i18n/messages.ts`

**Interfaces:**
- Consumes: Task 4 routes; `SectionPanel`, `HistoryButton`, `HistoryList`, `PagePeriod`, `Select`, `CheckboxField`.
- Produces: routes `/dengi`, `/dengi/cash-in|cash-out|bank-in|bank-out`, `/dengi/op/<id>`, `/dengi/peremeshcheniya`; server actions `cancelCash(id, reason)`, `restoreCash(id)`, `saveCash(id|null, input) → { ok; id?; message? }`; types `CashRow`, `CashList`, `CashOperationDetail`, `CashFormOptions` in `lib/api.ts`.

- [ ] **Step 1: Messages** (ru / uz): `nav.money` «Деньги» / «Pul»; `money.bank` «Банк» / «Bank»; `money.cash` «Касса» / «Kassa»; `money.refs` «Справочники» / «Ma'lumotnomalar»; `money.cash-in` «Поступления в кассу» / «Kassaga kirim»; `money.cash-out` «Расход из кассы» / «Kassadan chiqim»; `money.bank-in` «Поступления на счёт» / «Hisobga kirim»; `money.bank-out` «Расход со счёта» / «Hisobdan chiqim»; `money.transfers` «Перемещения денег» / «Pul ko'chirish»; `money.categories` «Статьи движения денег» / «Pul harakati moddalari»; `money.accounts` «Банковские счета» / «Bank hisoblari»; `money.from` «Откуда» / «Qayerdan»; `money.to` «Кому» / «Kimga»; `money.operation` «Операция» / «Operatsiya»; `money.comment` «Комментарий» / «Izoh»; `money.box` «Касса / счёт» / «Kassa / hisob»; `money.create` «Создать» / «Yaratish»; `money.show_cancelled` «Показать отменённые» / «Bekor qilinganlarni ko'rsatish»; `money.from_salesdoc` «из Salesdoc» / «Salesdoc'dan»; `money.cancel` «Отменить» / «Bekor qilish»; `money.restore` «Восстановить» / «Tiklash»; `money.cancel_reason` «Причина отмены» / «Bekor qilish sababi»; `money.confirm_cancel` «Отменить операцию {number}? Она останется в списке, но не будет учитываться.» / «{number} operatsiya bekor qilinsinmi? U ro'yxatda qoladi, lekin hisobga olinmaydi.»; `money.cancelled_banner` «Отменена: {by}, {at}. Причина: {reason}» / «Bekor qilingan: {by}, {at}. Sabab: {reason}»; `money.op_title` «{operation} {number} от {date}» / «{date} dagi {number} — {operation}»; `money.deposit_mirror` «Взнос наличными из кассы» / «Kassadan naqd pul topshirish»; and one key per operation `money.op.<code>` with the 1C wording (ru) and Uzbek: supplier_payment «Поставщику» / «Yetkazib beruvchiga»; expense «На расходы» / «Xarajatlarga»; payroll «Зарплата по ведомости» / «Vedomost bo'yicha ish haqi»; salary «Зарплата сотруднику» / «Xodimga ish haqi»; other_counterparty «Прочему контрагенту (учредителю)» / «Boshqa kontragentga (ta'sischiga)»; buyer_refund «Покупателю (возврат)» / «Xaridorga (qaytarish)»; credit_repayment «Возврат кредита» / «Kreditni qaytarish»; employee_loan «Выдача займа сотруднику» / «Xodimga qarz berish»; cash_to_bank «Взнос наличными в банк» / «Bankka naqd pul topshirish»; other_expense «Прочий расход» / «Boshqa xarajat»; accountable «Подотчётнику» / «Hisobdor shaxsga»; taxes «Налоги» / «Soliqlar»; from_buyer «От покупателя» / «Xaridordan»; supplier_refund «Возврат от поставщика» / «Yetkazib beruvchidan qaytim»; employee_loan_return «Возврат займа сотрудником» / «Xodimdan qarz qaytimi»; credit_received «Получение кредита» / «Kredit olish»; other_income «Прочее поступление» / «Boshqa kirim».

- [ ] **Step 2: Types** — `lib/api.ts`:

```ts
export type CashPage = "cash-in" | "cash-out" | "bank-in" | "bank-out";
export interface CashRow {
  id: string;
  number: string;
  source: "app" | "salesdoc";
  operation: string;
  direction: "in" | "out";
  account: "cash" | "bank";
  date: string;
  amount: string;
  cashboxSdId: string | null;
  cashboxName: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  supplierSdId: string | null;
  supplierName: string | null;
  outletSdId: string | null;
  categoryId: string | null;
  counterpartyName: string | null;
  party: string | null;
  comment: string | null;
  createdByName: string;
  cancelled: { by: string; at: string; reason: string } | null;
  mirrored?: true;
}
export interface CashList { total: string; rows: CashRow[]; filters: { operations: string[]; boxes: Array<{ id: string; name: string }> } }
export type CashOperationDetail = CashRow & { monthOpen: boolean };
export interface CashFormOptions {
  cashboxes: Array<{ id: string; name: string }>;
  bankAccounts: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  outlets: Array<{ id: string; name: string }>;
  expenseCategories: Array<{ id: string; name: string }>;
  incomeCategories: Array<{ id: string; name: string }>;
}
```

- [ ] **Step 3: Menu, panel, sidebar** — `lib/dengi-menu.ts`:

```ts
import type { MenuGroup } from "./zakupki-menu";

/** The Деньги panel (owner's pages, 6 Oct 2026), laid out like 1C. */
export const DENGI_MENU: MenuGroup[][] = [
  [
    { title: "money.bank", links: [{ label: "money.bank-in", href: "/dengi/bank-in" }, { label: "money.bank-out", href: "/dengi/bank-out" }] },
    { title: "money.cash", links: [{ label: "money.cash-in", href: "/dengi/cash-in" }, { label: "money.cash-out", href: "/dengi/cash-out" }] },
  ],
  [{ title: "nav.money", links: [{ label: "money.transfers", href: "/dengi/peremeshcheniya" }] }],
  [{ title: "money.refs", links: [{ label: "money.categories", href: "/dengi/stati" }, { label: "money.accounts", href: "/dengi/scheta" }] }],
];
```

`app/dengi/page.tsx` = `<SectionPanel title={t("nav.money")} menu={DENGI_MENU} />`; `peremeshcheniya/page.tsx` = `<PlaceholderPage title={t("money.transfers")} />`. In `layout.tsx` add `{ href: "/dengi", label: t("nav.money") }` after the Закупки item.

- [ ] **Step 4: A list page** — `app/dengi/[page]/page.tsx`: `notFound()` unless the param is one of the four pages. Server component like `zakupki/nakladnye/page.tsx`:
  - `res = apiGet<CashList>(`/cash/pages/${page}${qs({ from, to, operation, box, search, includeCancelled })}`)`, `history = apiGet<AuditEntry[]>(`/cash/pages/${page}/history`)`.
  - Header: `PageHeader title={t(`money.${page}`)}` with `PagePeriod`, a «Создать ▾» dropdown (Base UI `Popover` with one link per `filters.operations` code → `/dengi/op/new?page=<page>&operation=<code>`; a `buttonVariants()` trigger), and `HistoryButton` whose `HistoryList` uses `linkFor` = `/dengi/op/<target>`.
  - Filter form (GET, `action={`/dengi/${page}`}`): Select `operation` (all + `filters.operations` labelled `money.op.<code>`), Select `box` (all + `filters.boxes`), `Input search`, `CheckboxField includeCancelled`, «Применить».
  - Table: Дата (`formatDate(r.date)`), Номер (mono; for `source === "salesdoc"` add a `Badge variant="secondary"` «из Salesdoc»), `money.from` on `-in` pages / `money.to` on `-out` pages (= `r.party ?? "—"`), Сумма (`Money`), Операция (`r.mirrored ? t("money.deposit_mirror") : t(`money.op.${r.operation}`)`), Комментарий (`whitespace-normal`, max-w-64). App rows link the whole row to `/dengi/op/<id>` (as receipts do); Salesdoc rows don't link. Cancelled: `text-muted-foreground`, amount `line-through`, caption `money.cancelled_banner` under the number. Итого row with `res.data.total`.

- [ ] **Step 5: Operation page** — `app/dengi/op/[id]/page.tsx`: `apiGet<CashOperationDetail>(`/cash/operations/${id}`)` and its history; title `t("money.op_title", { operation: t(`money.op.${o.operation}`), number: o.number, date: formatDate(o.date) })`; a `Card` with fields: Дата, Сумма, Касса / счёт (`o.cashboxName ?? o.bankAccountName`), for cash_to_bank also «Счёт для взноса» (`o.bankAccountName`), «Кому / Откуда» (`o.party`), Комментарий, «Создал» (`o.createdByName`); cancelled banner like the receipt's; header actions `<OpActions id number monthOpen cancelled locale />` and `HistoryButton`.

`op-actions.tsx` (client) mirrors `receipt-actions.tsx`: closed month → caption `receipt.month_closed`; cancelled → «Восстановить» (`restoreCash`); otherwise link «Редактировать» (`/dengi/op/<id>/edit`) and «Отменить» → `Dialog` with `money.confirm_cancel`, required `Field` `money.cancel_reason` (error `errors.required` under it), spinner, server error in the dialog.

`actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { apiPost, apiPut } from "@/lib/api";

type Result = { ok: boolean; id?: string; message?: string };
const done = (res: { ok: boolean; message?: string }, id?: string): Result => {
  revalidatePath("/", "layout");
  return res.ok ? { ok: true, id } : { ok: false, message: res.message };
};

export async function saveCash(id: string | null, input: Record<string, unknown>): Promise<Result> {
  if (id) return done(await apiPut(`/cash/operations/${encodeURIComponent(id)}`, input), id);
  const res = await apiPost<{ id: string; number: string }>("/cash/operations", input);
  return done(res, res.ok ? res.data.id : undefined);
}
export async function cancelCash(id: string, reason: string): Promise<Result> {
  return done(await apiPost(`/cash/operations/${encodeURIComponent(id)}/cancel`, { reason }));
}
export async function restoreCash(id: string): Promise<Result> {
  return done(await apiPost(`/cash/operations/${encodeURIComponent(id)}/restore`));
}
```

- [ ] **Step 6: Check** — tsc, eslint (unfiltered) clean. Browser against Supabase, read-only: sidebar «Деньги» opens the panel; each of the four lists renders (Поступления pages show Salesdoc payments with «из Salesdoc»; Расход pages empty with Итого 0,00); filters apply; «История» opens (empty); ru/uz; 390 px.

- [ ] **Step 7: Commit** — `git commit -m "feat(web): Деньги section — panel, four lists, operation page"`

---

### Task 8: Create and edit form

**Files:**
- Create: `apps/web/src/app/dengi/cash-form.tsx`, `apps/web/src/app/dengi/op/new/page.tsx`, `apps/web/src/app/dengi/op/[id]/edit/page.tsx`, `apps/web/src/lib/cash-ops.ts`, `apps/web/src/lib/cash-ops.test.ts`
- Modify: `apps/web/src/i18n/messages.ts`, `apps/web/src/components/app/product-picker.tsx` (rename props stay; add an optional `emptyLabel`)

**Interfaces:**
- Consumes: Task 7 `saveCash`, `CashFormOptions`, `GET /cash/form-options`, `GET /months`; `DateField`, `Select`, `Field`, `ProductPicker`, `dateProblem`, `decimals` (`lib/receipt-rules.ts`).
- Produces: `NEEDS: Record<string, 'supplier'|'outlet'|'expenseCategory'|'incomeCategory'|'name'|'none'>` and `DEPOSIT = 'cash_to_bank'` in `lib/cash-ops.ts` (mirror of the API catalogue, test-pinned); `<CashForm page operation initial? id? options closedMonths today locale />`.

- [ ] **Step 1: Failing test** — `lib/cash-ops.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEEDS, needsOf } from "./cash-ops";

test("every operation names the one field its form needs", () => {
  assert.equal(Object.keys(NEEDS).length, 17);
  assert.equal(needsOf("supplier_payment"), "supplier");
  assert.equal(needsOf("buyer_refund"), "outlet");
  assert.equal(needsOf("taxes"), "expenseCategory");
  assert.equal(needsOf("other_income"), "incomeCategory");
  assert.equal(needsOf("salary"), "name");
  assert.equal(needsOf("payroll"), "none");
  assert.equal(needsOf("cash_to_bank"), "none");
  assert.equal(needsOf("nope"), "none");
});
```

Run `npx tsx --test src/lib/cash-ops.test.ts` · Expected: FAIL «Cannot find module './cash-ops'».

- [ ] **Step 2: Implement** — `lib/cash-ops.ts`:

```ts
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
```

Run the test · Expected: PASS.

- [ ] **Step 3: Messages** (ru / uz): `money.date` «Дата» / «Sana»; `money.amount` «Сумма» / «Summa»; `money.cashbox` «Касса» / «Kassa»; `money.bank_account` «Счёт» / «Hisob»; `money.deposit_to` «Счёт для взноса» / «Topshiriladigan hisob»; `money.supplier` «Поставщик» / «Yetkazib beruvchi»; `money.buyer` «Покупатель» / «Xaridor»; `money.category` «Статья» / «Modda»; `money.party_name` «Кому / от кого» / «Kimga / kimdan»; `money.save` «Сохранить» / «Saqlash»; `money.new_title` «{operation}: новая операция» / «{operation}: yangi operatsiya»; `money.edit_title` «Редактирование {number}» / «{number} ni tahrirlash»; `money.choose` «Выберите…» / «Tanlang…»; `money.search` «Поиск» / «Qidirish».

- [ ] **Step 4: Form** — `cash-form.tsx` (client), props `{ page: CashPage; operation: string; id?: string; initial?: Partial<{date; amount; cashboxSdId; bankAccountId; supplierSdId; outletSdId; categoryId; counterpartyName; comment}>; options: CashFormOptions; closedMonths: string[]; today: string; locale: Locale }`:
  - `account = page.startsWith("cash") ? "cash" : "bank"`; `needs = needsOf(operation)`.
  - Fields in order, each with its own error under it:
    1. `DateField` «Дата» (`min="2026-09-01"`; on change show `dateProblem(...)` message as the receipt editor does: before → `errors.before_window`, future → `errors.future`, closed → `errors.month_closed`).
    2. `account === "cash"` → `Select` «Касса» (`options.cashboxes`), else `Select` «Счёт» (`options.bankAccounts`).
    3. `operation === DEPOSIT` → `Select` «Счёт для взноса» (`options.bankAccounts`).
    4. by `needs`: supplier → `Select` (`options.suppliers`); outlet → `ProductPicker` over `options.outlets` mapped to `{sdId: id, name}` with `placeholder={t("money.choose")}` `searchLabel={t("money.search")}`; expenseCategory / incomeCategory → `Select` over the matching list; name → `Field` text «Кому / от кого».
    5. `Field` «Сумма» (`inputMode="decimal"`): empty → `errors.required`; ≤ 0 → `errors.positive`; `decimals > 2` → `errors.max_decimals` n=2.
    6. `Field` «Комментарий».
  - Submit: validate all (required selects → `errors.required`), then `saveCash(id ?? null, { operation, account, date, amount, cashboxSdId, bankAccountId, targetBankAccountId, supplierSdId, outletSdId, categoryId, counterpartyName, comment })` (for `cash_to_bank` send the deposit account as `targetBankAccountId`); the server's message in one alert above «Сохранить»; «Сохранить» disabled with a spinner while saving; success → `router.push(`/dengi/op/${id ?? r.id}`)`.
  - Layout: `flex flex-col gap-4 max-w-xl`; inputs full width at 390 px.

- [ ] **Step 5: Pages** — `op/new/page.tsx`: read `?page&operation`; `notFound()` unless page is valid and `operation` is in `GET /cash/pages/<page>`'s `filters.operations` (fetch `/cash/form-options` and `/months` too). Title `money.new_title`. `op/[id]/edit/page.tsx`: load the operation; if cancelled or `!monthOpen` show the banner / `receipt.month_closed` instead of the form; `page` = `${o.account}-${o.direction}`; `initial` from the operation (`amount: String(Number(o.amount))`; for cash_to_bank the deposit account is `o.bankAccountId`).

- [ ] **Step 6: Check** — tsc, eslint, `npx tsx --test src/lib/*.test.ts` · Expected: all pass. **Browser against the test instance only** (Task 10's setup) — never save on Supabase while developing.

- [ ] **Step 7: Commit** — `git commit -m "feat(web): create and edit cash operations"`

---

### Task 9: Справочники — статьи, bank accounts, payment types

**Files:**
- Create: `apps/web/src/app/dengi/stati/page.tsx`, `apps/web/src/app/dengi/scheta/page.tsx`, `apps/web/src/app/dengi/ref-row.tsx`, `apps/web/src/app/dengi/refs-actions.ts`
- Modify: `apps/web/src/i18n/messages.ts`

**Interfaces:**
- Consumes: Task 2 routes.
- Produces: server actions `addRef(kind: 'categories'|'bank-accounts', body)`, `patchRef(kind, id, body)`, `setPaymentTypeAccount(sdId, account)` → `{ ok; message? }`.

- [ ] **Step 1: Messages** (ru / uz): `refs.expense` «Статьи расходов» / «Xarajat moddalari»; `refs.income` «Статьи доходов» / «Daromad moddalari»; `refs.add` «Добавить» / «Qo'shish»; `refs.name` «Название» / «Nomi»; `refs.rename` «Переименовать» / «Nomini o'zgartirish»; `refs.deactivate` «Скрыть» / «Yashirish»; `refs.activate` «Вернуть» / «Qaytarish»; `refs.inactive` «скрыта» / «yashirilgan»; `refs.placeholder_note` «Список заполнит ответственный; до тех пор используйте «Прочие расходы» / «Прочие доходы».» / «Ro'yxatni mas'ul to'ldiradi; ungacha «Прочие расходы» / «Прочие доходы» dan foydalaning.»; `refs.payment_types` «Оплаты покупателей из Salesdoc» / «Salesdoc'dan xaridor to'lovlari»; `refs.goes_to` «Попадают в» / «Qayerga tushadi»; `refs.to_cash` «Кассу» / «Kassaga»; `refs.to_bank` «Счёт» / «Hisobga».

- [ ] **Step 2: `refs-actions.ts`**:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { apiPatch, apiPost, apiPut } from "@/lib/api";

type Result = { ok: boolean; message?: string };
const done = (r: { ok: boolean; message?: string }): Result => {
  revalidatePath("/dengi", "layout");
  return r.ok ? { ok: true } : { ok: false, message: r.message };
};
export async function addRef(kind: "categories" | "bank-accounts", body: { name: string; kind?: string }) {
  return done(await apiPost(`/cash/${kind}`, body));
}
export async function patchRef(kind: "categories" | "bank-accounts", id: string, body: { name?: string; active?: boolean }) {
  return done(await apiPatch(`/cash/${kind}/${encodeURIComponent(id)}`, body));
}
export async function setPaymentTypeAccount(sdId: string, account: "cash" | "bank") {
  return done(await apiPut(`/cash/payment-types/${encodeURIComponent(sdId)}`, { account }));
}
```

Add `export const apiPatch = withBody("PATCH");` to `lib/api.ts`.

- [ ] **Step 3: `ref-row.tsx`** (client): one row = name (or an inline `Input` while renaming), «скрыта» badge when inactive, buttons «Переименовать» / «Сохранить», «Скрыть» / «Вернуть», each with spinner and an error under the row; plus an `AddRef` form (`Field` «Название», «Добавить», error under the field) exported from the same file.

- [ ] **Step 4: Pages** — `stati/page.tsx`: caption `refs.placeholder_note`; two cards «Статьи расходов» / «Статьи доходов» each listing `RefRow`s and an `AddRef` with `kind`. `scheta/page.tsx`: card «Банковские счета» (rows + add); card «Оплаты покупателей из Salesdoc»: table name · `Select` (controlled) «Кассу» / «Счёт» calling `setPaymentTypeAccount` on change with a spinner.

- [ ] **Step 5: Check** — tsc, eslint clean; browser against the test instance: add «Транспорт», rename, hide → disappears from the «На расходы» form's list but an old operation still shows «Транспорт»; add a bank account; switch «Терминал» to «Счёт» → its payments move from Поступления в кассу to Поступления на счёт.

- [ ] **Step 6: Commit** — `git commit -m "feat(web): статьи, bank accounts and payment-type pages"`

---

### Task 10: Whole-flow browser check on the test instance

**Files:** none committed (scripts live in the scratchpad).

- [ ] **Step 1: Start a test API and web** — API: `cd apps/api && npx nest build` then, in a new window titled «df TEST API», `set DATABASE_URL=<DATABASE_URL_TEST>&& set PORT=4100&& set SYNC_SCHEDULE=off&& set SALESDOC_CREDENTIALS_FILE=data/__missing__.json&& node dist/main.js`. Web: new window «df TEST WEB», `set API_URL=http://localhost:4100/api&& npx next dev -p 3100` in `apps/web`. Create a test user in the test DB: `DATABASE_URL=<test> npm run user:add -w @df/api` is interactive — instead insert with a tsx one-off that calls `AuthService.createUser('check','Проверка','check-pass-123')` against the test URL. Seed: one cashbox, one supplier, one outlet, two payment types, two Salesdoc payments, one bank account, one expense статья (a tsx one-off, same pattern as the specs' setup).

- [ ] **Step 2: Drive it** (Playwright from the scratchpad, `MSYS_NO_PATHCONV=1`):
  1. «Расход со счёта» → «Создать» → «Поставщику»: empty submit shows every required error under its field; fill and save → lands on the operation page; list shows it, Итого updated; Поставщики (on :3100) «Оплачено» equals the amount.
  2. «Расход из кассы» → «Взнос наличными в банк» → appears on Расход из кассы and Поступления на счёт («Взнос наличными из кассы»).
  3. Edit the payment amount → history (operation page «История») shows «Изменена» with Было → Стало.
  4. «Отменить» with empty reason refused, with a reason → struck through, Итого and «Оплачено» drop; «Восстановить» brings both back.
  5. Close October on the test instance → operation page shows «Месяц закрыт», no buttons; create form date in October shows «Месяц закрыт» under the date.
  6. «История» on each list and on Приходные накладные opens and lists entries with «Открыть» links.
  7. ru and uz; 390 px on a list, the form and the operation page (no horizontal page scroll).
- [ ] **Step 3:** Stop the two test windows. Ledger the results (screenshots in the scratchpad).

---

## Self-review

- Spec §2 accounts → Tasks 1, 2, 9. §3 operations table and rules → Tasks 1, 3. §4 catalogue → Tasks 3, 8 (mirrored and test-pinned on both sides). «Взнос» on two pages → Task 4. §5 статьи → Tasks 2, 9. §6 Salesdoc buyer payments and the per-type split → Tasks 2, 4, 9 (default: only «Перечисление» → счёт, as spec §6). §7 pages → Tasks 7, 8, 9. §8 «История» → Tasks 4 (endpoints), 6, 7. §9 supplier «Оплачено» → Task 5. §10 testing → each task plus Task 10.
- Placeholder scan: none of TBD/TODO; every code step carries code.
- Names: `CashService.list/history/historyOf/formOptions/create/update/cancel/restore/get`, `CashRefsService.*`, `opsForPage`, `cashNumber`, `needsOf` are used with the same signatures across tasks; `CashRow` matches `view()` plus `mirrored`.
